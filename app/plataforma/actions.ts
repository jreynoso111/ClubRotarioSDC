"use server";

import { revalidatePath } from "next/cache";
import { updateMemberAccessAction } from "./members-actions";

import { isMissingSchemaError, type ProposalVoteChoice } from "@/lib/platform";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";
import { auditCursorFilter, auditPageCursor, defaultAuditSort, normalizeAuditQuery } from "@/lib/audit";
import type { AuditCursor, AuditDetail, AuditDetailResult, AuditEntry, AuditFilters, AuditPageResult, AuditSort } from "@/lib/audit";
import { isStoryAssetPath, MAX_EDITORIAL_CONTENT_LENGTH, parseEditorialContent } from "@/lib/editorial-content";
import type { MembershipApplication, MembershipApplicationStatus } from "@/lib/membership-applications";
import type {
  FinanceCategory,
  FinanceDashboard,
  FinanceEntryCategory,
  FinanceLedgerEntry,
  FinanceMonthlyDue,
  FinancePaymentMethod,
  FinancePeriodSummary,
} from "@/lib/finance";

type ActionCode =
  | "unauthenticated"
  | "pending"
  | "suspended"
  | "forbidden"
  | "invalid"
  | "migration_missing"
  | "backend_error";

export type PlatformActionResult = {
  ok: boolean;
  message: string;
  code?: ActionCode;
  id?: string;
};

type PlatformRole = "member" | "coordinator" | "editor" | "club_manager" | "admin";
type MembershipStatus = "pending" | "active" | "suspended";
type MembershipPhotoSlotKey = "membership-community" | "membership-service" | "membership-fellowship";
type CommitteeRole = "member" | "chair" | "secretary" | "treasurer";

type Actor = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: PlatformRole;
};

type MembershipRecord = {
  membership_role: string;
  membership_status: MembershipStatus;
};

function failure(message: string, code: ActionCode = "backend_error"): PlatformActionResult {
  return { ok: false, message, code };
}

function success(message: string, id?: string): PlatformActionResult {
  return { ok: true, message, ...(id ? { id } : {}) };
}

function roleFrom(value: string | null | undefined): PlatformRole {
  if (
    value === "coordinator" ||
    value === "editor" ||
    value === "club_manager" ||
    value === "admin"
  ) {
    return value;
  }

  return "member";
}

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maximum ? cleaned : null;
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length <= maximum ? cleaned || null : null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function dateToIso(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorFor(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (isMissingSchemaError(error)) {
    return failure(
      "Este módulo todavía no está disponible porque falta aplicar la migración de la plataforma en Supabase.",
      "migration_missing",
    );
  }

  return failure("No se pudo guardar el cambio. Revisa los datos e inténtalo de nuevo.");
}

async function requireActor(requiredRoles: PlatformRole[] = []):
  Promise<{ actor?: Actor; error?: PlatformActionResult }> {
  if (!isSupabaseConfigured()) {
    return {
      error: failure("La plataforma no tiene configurada la conexión de Supabase.", "backend_error"),
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { error: failure("No se pudo configurar la conexión del club.") };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: failure("Tu sesión ya no está activa. Vuelve a iniciar sesión.", "unauthenticated") };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("membership_role,membership_status")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError) return { error: errorFor(membershipError) };
  if (!membership) {
    return { error: failure("Tu cuenta todavía no tiene una membresía asociada.", "pending") };
  }

  const record = membership as MembershipRecord;
  if (record.membership_status === "pending") {
    return { error: failure("Tu solicitud todavía está pendiente de aprobación.", "pending") };
  }
  if (record.membership_status !== "active") {
    return { error: failure("Tu membresía está suspendida y no puede realizar esta acción.", "suspended") };
  }

  const role = roleFrom(record.membership_role);
  if (requiredRoles.length > 0 && !requiredRoles.includes(role)) {
    return { error: failure("Tu rol actual no tiene permiso para realizar esta acción.", "forbidden") };
  }

  return { actor: { supabase, userId: userData.user.id, role } };
}

function canPublish(role: PlatformRole) {
  return role === "editor" || role === "club_manager" || role === "admin";
}

const membershipPhotoSlotKeys = [
  "membership-community",
  "membership-service",
  "membership-fellowship",
] as const;

function isMembershipPhotoSlotKey(value: unknown): value is MembershipPhotoSlotKey {
  return membershipPhotoSlotKeys.includes(value as MembershipPhotoSlotKey);
}

function isMembershipPhotoAssetPath(value: unknown, slotKey: MembershipPhotoSlotKey) {
  if (typeof value !== "string") return false;
  const prefix = `site-photos/membership-application/${slotKey}/`;
  return value.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(value.slice(prefix.length));
}

export async function createProposalAction(input: {
  title: string;
  summary: string;
  details?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;

  const title = cleanText(input?.title, 180);
  const summary = cleanText(input?.summary, 1200);
  const details = optionalText(input?.details, 4000) ?? "";
  if (!title || !summary || summary.length < 10) {
    return failure("Escribe un título y un resumen de al menos 10 caracteres.", "invalid");
  }

  const { data, error: insertError } = await actor!.supabase
    .from("proposals")
    .insert({ title, summary, details, created_by: actor!.userId })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidatePath("/plataforma");
  return success("La propuesta quedó guardada como borrador.", data.id);
}

export async function submitProposalAction(proposalId: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(proposalId)) return failure("La propuesta indicada no es válida.", "invalid");

  const { error: submitError } = await actor!.supabase.rpc("submit_proposal", {
    _proposal_id: proposalId,
  });
  if (submitError) return errorFor(submitError);

  revalidatePath("/plataforma");
  return success("La propuesta fue enviada para revisión.");
}

export async function setProposalVotingAction(
  proposalId: string,
  enabled: boolean,
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(proposalId) || typeof enabled !== "boolean") {
    return failure("La votación indicada no es válida.", "invalid");
  }

  const { data: proposal, error: proposalError } = await actor!.supabase
    .from("proposals")
    .select("id,status,voting_open")
    .eq("id", proposalId)
    .maybeSingle();
  if (proposalError) return errorFor(proposalError);
  if (!proposal) return failure("La propuesta ya no está disponible. Actualiza la plataforma.", "invalid");
  if (enabled && !["submitted", "in_review"].includes(proposal.status)) {
    return failure("Solo se puede activar la votación mientras la propuesta está en revisión.", "invalid");
  }
  if (proposal.voting_open === enabled) {
    return success(enabled ? "La votación ya está abierta." : "La votación ya está cerrada.");
  }

  const { data, error: updateError } = await actor!.supabase
    .from("proposals")
    .update({ voting_open: enabled })
    .eq("id", proposalId)
    .select("id")
    .maybeSingle();
  if (updateError) return errorFor(updateError);
  if (!data) return failure("No se pudo cambiar el estado de la votación. Actualiza la plataforma.", "invalid");

  revalidatePath("/plataforma");
  return success(
    enabled
      ? "La votación quedó abierta para los miembros activos."
      : "La votación quedó cerrada y sus resultados están disponibles.",
    proposalId,
  );
}

export async function castProposalVoteAction(
  proposalId: string,
  voteChoice: ProposalVoteChoice,
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(proposalId) || !["for", "against", "abstain"].includes(voteChoice)) {
    return failure("El voto indicado no es válido.", "invalid");
  }

  const { error: voteError } = await actor!.supabase.from("proposal_votes").upsert(
    {
      proposal_id: proposalId,
      user_id: actor!.userId,
      vote_choice: voteChoice,
    },
    { onConflict: "proposal_id,user_id" },
  );
  if (voteError) return errorFor(voteError);

  revalidatePath("/plataforma");
  return success(
    voteChoice === "for"
      ? "Tu voto quedó registrado a favor."
      : voteChoice === "against"
        ? "Tu voto quedó registrado en contra."
        : "Tu abstención quedó registrada.",
  );
}

function validFinanceMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}

function financeDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function financeAmount(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) return null;
  return normalized;
}

const financeMethods: FinancePaymentMethod[] = ["cash", "bank_transfer", "card", "check", "other"];

export async function getFinanceDashboardAction(
  month: string,
  filters: { memberId?: string; activityId?: string; page?: number } = {},
): Promise<PlatformActionResult & { dashboard?: FinanceDashboard }> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!validFinanceMonth(month)) return failure("Selecciona un mes válido para consultar Finanzas.", "invalid");

  if ((filters.memberId && !isUuid(filters.memberId)) || (filters.activityId && !isUuid(filters.activityId))
    || (filters.page !== undefined && (!Number.isInteger(filters.page) || filters.page < 0 || filters.page > 10000))) {
    return failure("Revisa los filtros financieros.", "invalid");
  }
  const page = filters.page ?? 0;
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const canManage = actor!.role === "club_manager" || actor!.role === "admin";
  const supabase = actor!.supabase;
  let entriesQuery = supabase.from("finance_entries")
    .select("id,direction,category,amount,occurred_on,description,member_id,member_name_snapshot,counterparty_name,activity_id,activity_name_snapshot,monthly_due_id,payment_method,receipt_reference")
    .gte("occurred_on", monthStart).lt("occurred_on", nextMonthStart)
    .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (filters.memberId) entriesQuery = entriesQuery.eq("member_id", filters.memberId);
  if (filters.activityId) entriesQuery = entriesQuery.eq("activity_id", filters.activityId);
  const [summaryResult, duesResult, entriesResult, membersResult, activitiesResult, scopeResult] = await Promise.all([
    supabase.rpc("get_finance_period_summary", { _month_start: monthStart }),
    supabase.rpc("get_finance_month_dues", { _month_start: monthStart }),
    entriesQuery.range(page * 50, page * 50 + 49),
    canManage
      ? supabase
          .from("memberships")
          .select("user_id,membership_status,profile:profiles!memberships_user_id_fkey(display_name)")
          .order("user_id", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("activities")
          .select("id,title")
          .order("starts_at", { ascending: false, nullsFirst: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("get_finance_scope_totals", { _month_start: monthStart, _member_id: filters.memberId || null, _activity_id: filters.activityId || null }),
  ]);

  const queryErrors = [
    summaryResult.error,
    duesResult.error,
    entriesResult.error,
    membersResult.error,
    activitiesResult.error,
    scopeResult.error,
  ].filter(Boolean);
  if (queryErrors.some((queryError) => isMissingSchemaError(queryError))) {
    return failure(
      "Finanzas está preparado en la plataforma, pero falta aplicar la migración club_finance_management en Supabase.",
      "migration_missing",
    );
  }
  if (queryErrors.length > 0) {
    return failure("No se pudieron cargar los datos financieros. Inténtalo de nuevo.");
  }

  type SummaryRow = {
    income_total: string | number;
    expense_total: string | number;
    balance: string | number;
    dues_total: string | number;
    dues_paid: string | number;
    dues_outstanding: string | number;
    dues_count: number;
  };
  type DueRow = {
    due_id: string;
    member_id: string | null;
    member_name: string;
    due_month: string;
    amount_due: string | number;
    amount_paid: string | number;
  };
  type EntryRow = {
    id: string;
    direction: string;
    category: string;
    amount: string | number;
    occurred_on: string;
    description: string;
    member_id: string | null;
    member_name_snapshot: string | null;
    counterparty_name: string | null;
    activity_id: string | null;
    activity_name_snapshot: string | null;
    monthly_due_id: string | null;
    payment_method: string;
    receipt_reference: string | null;
  };
  type MemberRow = {
    user_id: string;
    membership_status: string;
    profile: { display_name: string | null } | null;
  };
  type ActivityOptionRow = { id: string; title: string };

  const summary = ((summaryResult.data ?? []) as unknown as SummaryRow[])[0];
  if (!summary) return failure("No se pudo calcular el resumen de Finanzas.");
  const summaryData: FinancePeriodSummary = {
    incomeTotal: String(summary.income_total),
    expenseTotal: String(summary.expense_total),
    balance: String(summary.balance),
    duesTotal: String(summary.dues_total),
    duesPaid: String(summary.dues_paid),
    duesOutstanding: String(summary.dues_outstanding),
    duesCount: Number(summary.dues_count),
  };
  const dues = ((duesResult.data ?? []) as unknown as DueRow[]).map((due): FinanceMonthlyDue => ({
    id: due.due_id,
    memberId: due.member_id,
    memberName: due.member_name,
    dueMonth: due.due_month,
    amountDue: String(due.amount_due),
    amountPaid: String(due.amount_paid),
  }));
  const entries = ((entriesResult.data ?? []) as unknown as EntryRow[]).map((entry): FinanceLedgerEntry => ({
    id: entry.id,
    direction: entry.direction as "income" | "expense",
    category: entry.category as FinanceCategory,
    amount: String(entry.amount),
    occurredOn: entry.occurred_on,
    description: entry.description,
    memberId: entry.member_id,
    memberName: entry.member_name_snapshot,
    counterpartyName: entry.counterparty_name,
    activityId: entry.activity_id,
    activityName: entry.activity_name_snapshot,
    monthlyDueId: entry.monthly_due_id,
    paymentMethod: entry.payment_method as FinancePaymentMethod,
    receiptReference: entry.receipt_reference,
  }));
  const members = ((membersResult.data ?? []) as unknown as MemberRow[]).map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name?.trim() || "Miembro del club",
    active: member.membership_status === "active",
  }));
  const activities = ((activitiesResult.data ?? []) as unknown as ActivityOptionRow[]).map((activity) => ({
    id: activity.id,
    name: activity.title,
  }));

  return {
    ...success("Resumen financiero cargado."),
    dashboard: { monthStart, summary: summaryData, dues, entries, members, activities,
      page, scope: { income: String(scopeResult.data?.[0]?.income_total ?? 0), expense: String(scopeResult.data?.[0]?.expense_total ?? 0), count: Number(scopeResult.data?.[0]?.entry_count ?? 0) } },
  };
}

export async function createFinanceMonthlyDuesAction(input: {
  month: string;
  amountDue: string;
  memberIds?: string[];
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;
  if (!validFinanceMonth(input?.month)) return failure("Selecciona un mes válido para generar los aportes.", "invalid");
  const amountDue = financeAmount(input?.amountDue);
  if (!amountDue) return failure("Indica un aporte mensual mayor que cero, con hasta dos decimales.", "invalid");

  if (input.memberIds !== undefined && (!Array.isArray(input.memberIds) || input.memberIds.length < 1
    || input.memberIds.length > 200 || input.memberIds.some(id => !isUuid(id)) || new Set(input.memberIds).size !== input.memberIds.length)) {
    return failure("Selecciona al menos un miembro y evita repetirlo.", "invalid");
  }
  const { data, error: insertError } = await actor!.supabase.rpc(input.memberIds ? "create_finance_member_dues" : "create_finance_monthly_dues", {
    _due_month: `${input.month}-01`,
    _amount_due: amountDue,
    ...(input.memberIds ? { _member_ids: input.memberIds } : {}),
  });
  if (insertError) return errorFor(insertError);
  revalidatePath("/plataforma");
  const count = Number(data ?? 0);
  return success(count > 0
    ? `Se generaron ${count} aportes mensuales por miembro para ${input.month}.`
    : `No se generaron aportes: el mes ${input.month} ya tenía cuotas para las membresías activas.`);
}

export async function createFinanceEntryAction(input: {
  category: FinanceEntryCategory;
  amount: string;
  occurredOn: string;
  description: string;
  memberId?: string;
  counterpartyName?: string;
  activityId?: string;
  paymentMethod: FinancePaymentMethod;
  receiptReference?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;

  const validCategories: FinanceEntryCategory[] = [
    "activity_contribution", "donation", "other_income",
    "activity_expense", "operating_expense", "other_expense",
  ];
  const amount = financeAmount(input?.amount);
  const description = cleanText(input?.description, 500);
  if (!validCategories.includes(input?.category)
    || !amount
    || !financeDate(input?.occurredOn)
    || !description || description.length < 3
    || !financeMethods.includes(input?.paymentMethod)
    || (input?.memberId && !isUuid(input.memberId))
    || (input?.activityId && !isUuid(input.activityId))
    || ((input?.category === "activity_contribution" || input?.category === "activity_expense") && !input?.activityId)
    || (input?.counterpartyName && input.counterpartyName.trim().length > 120)
    || (input?.receiptReference && input.receiptReference.trim().length > 120)) {
    return failure("Revisa el tipo, monto, fecha y datos relacionados del movimiento.", "invalid");
  }

  const direction = input.category.endsWith("expense") ? "expense" : "income";
  const { data, error: insertError } = await actor!.supabase.rpc("create_finance_entry", {
    _direction: direction,
    _category: input.category,
    _amount: amount,
    _occurred_on: input.occurredOn,
    _description: description,
    _member_id: input.memberId || null,
    _counterparty_name: input.counterpartyName?.trim() || null,
    _activity_id: input.activityId || null,
    _payment_method: input.paymentMethod,
    _receipt_reference: input.receiptReference?.trim() || null,
  });
  if (insertError) return errorFor(insertError);
  revalidatePath("/plataforma");
  return success("El movimiento quedó registrado y auditado.", String(data));
}

export async function recordFinanceMonthlyPaymentAction(input: {
  dueId: string;
  amount: string;
  occurredOn: string;
  paymentMethod: FinancePaymentMethod;
  receiptReference?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;
  const amount = financeAmount(input?.amount);
  if (!isUuid(input?.dueId)
    || !amount
    || !financeDate(input?.occurredOn)
    || !financeMethods.includes(input?.paymentMethod)
    || (input?.receiptReference && input.receiptReference.trim().length > 120)) {
    return failure("Revisa el monto, fecha y referencia del pago.", "invalid");
  }

  const { data, error: paymentError } = await actor!.supabase.rpc("record_finance_monthly_payment", {
    _due_id: input.dueId,
    _amount: amount,
    _occurred_on: input.occurredOn,
    _payment_method: input.paymentMethod,
    _receipt_reference: input.receiptReference?.trim() || null,
  });
  if (paymentError) return errorFor(paymentError);
  revalidatePath("/plataforma");
  return success("El pago mensual quedó registrado y auditado.", String(data));
}

export async function rsvpEventAction(
  eventId: string,
  status: "going" | "maybe" | "declined",
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(eventId) || !["going", "maybe", "declined"].includes(status)) {
    return failure("La asistencia indicada no es válida.", "invalid");
  }

  const { data: event, error: eventError } = await actor!.supabase
    .from("events")
    .select("id,status,starts_at,ends_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return errorFor(eventError);
  if (!event || event.status !== "published") {
    return failure("Este evento no está abierto para confirmar asistencia.", "invalid");
  }
  if (new Date(event.ends_at ?? event.starts_at).getTime() <= Date.now()) {
    return failure("Este evento ya finalizó y no admite nuevas confirmaciones.", "invalid");
  }

  const { error: upsertError } = await actor!.supabase.from("event_rsvps").upsert(
    {
      event_id: eventId,
      user_id: actor!.userId,
      rsvp_status: status,
    },
    { onConflict: "event_id,user_id" },
  );
  if (upsertError) return errorFor(upsertError);

  revalidatePath("/plataforma");
  return success(
    status === "going"
      ? "Tu asistencia quedó confirmada."
      : status === "maybe"
        ? "Marcaste que quizá asistirás."
        : "Marcaste que no asistirás.",
  );
}

export type EventInput = {
  title: string;
  summary?: string;
  description?: string;
  kind: string;
  startsAt: string;
  endsAt?: string;
  venueName?: string;
  venueAddress?: string;
  locationUrl?: string;
  capacity?: string | number;
  status?: "draft" | "published" | "cancelled" | "archived";
  isPublic?: boolean;
};

function eventFields(input: EventInput) {
  const title = cleanText(input?.title, 160);
  const summary = optionalText(input?.summary, 600);
  const description = optionalText(input?.description, 8000);
  const startsAt = dateToIso(input?.startsAt);
  const endsAt = input?.endsAt ? dateToIso(input.endsAt) : null;
  const venueName = optionalText(input?.venueName, 180);
  const venueAddress = optionalText(input?.venueAddress, 300);
  const locationUrl = optionalText(input?.locationUrl, 500);
  const kind = ["encuentro", "servicio", "plataforma", "reunion", "otro"].includes(input?.kind)
    ? input.kind
    : "encuentro";
  const status = input?.status ?? "draft";
  const isPublic = Boolean(input?.isPublic);

  if (!title || title.length < 3 || !startsAt || (input?.endsAt && !endsAt)) {
    return { error: failure("Completa el título y una fecha válida para el evento.", "invalid") };
  }
  if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return { error: failure("La fecha de cierre debe ser posterior al inicio.", "invalid") };
  }
  if (locationUrl && !/^https?:\/\//i.test(locationUrl)) {
    return { error: failure("El enlace de ubicación debe comenzar con https:// o http://.", "invalid") };
  }
  const numericCapacity =
    input?.capacity === undefined || input.capacity === "" ? null : Number(input.capacity);
  if (numericCapacity !== null && (!Number.isInteger(numericCapacity) || numericCapacity < 0)) {
    return { error: failure("La capacidad debe ser un número entero igual o mayor que cero.", "invalid") };
  }
  if (!["draft", "published", "cancelled", "archived"].includes(status)) {
    return { error: failure("El estado del evento no es válido.", "invalid") };
  }

  return { data: {
    title, summary, description, kind,
    tone: kind === "servicio" ? "sun" : kind === "reunion" ? "coral" : "lime",
    starts_at: startsAt, ends_at: endsAt,
    venue_name: venueName, venue_address: venueAddress, location_url: locationUrl,
    capacity: numericCapacity, status, is_public: status === "published" && isPublic,
  } };
}

function revalidateEvents() {
  revalidatePath("/plataforma");
  revalidatePath("/");
  revalidatePath("/eventos");
  revalidatePath("/eventos/[slug]", "page");
}

export async function createEventAction(input: EventInput): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "editor", "club_manager", "admin"]);
  if (error) return error;
  const fields = eventFields(input);
  if (fields.error) return fields.error;
  if (!["draft", "published"].includes(fields.data.status)) {
    return failure("Crea el evento como borrador o publicado.", "invalid");
  }
  if (fields.data.status === "published" && !canPublish(actor!.role)) {
    return failure("Tu rol puede preparar el evento, pero un editor o gestor debe publicarlo.", "forbidden");
  }

  const slug = slugify(fields.data.title);
  if (!slug) return failure("El título no permite crear un enlace válido.", "invalid");

  const { data, error: insertError } = await actor!.supabase
    .from("events")
    .insert({
      ...fields.data,
      slug,
      created_by: actor!.userId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidateEvents();
  return success(fields.data.status === "published" ? "El evento fue publicado." : "El evento quedó guardado como borrador.", data.id);
}

export async function updateEventAction(eventId: string, input: EventInput): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "editor", "club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(eventId)) return failure("El evento indicado no es válido.", "invalid");
  const fields = eventFields(input);
  if (fields.error) return fields.error;

  const existing = await actor!.supabase.from("events").select("id,status").eq("id", eventId).maybeSingle();
  if (existing.error) return errorFor(existing.error);
  if (!existing.data) return failure("El evento ya no está disponible. Actualiza la agenda.", "invalid");
  if (fields.data.status === "published" && existing.data.status !== "published" && !canPublish(actor!.role)) {
    return failure("Un editor o gestor debe publicar este evento.", "forbidden");
  }

  // Keep the slug so shared event links remain valid after editing its title.
  const result = await actor!.supabase.from("events").update(fields.data).eq("id", eventId).select("id").maybeSingle();
  if (result.error) return errorFor(result.error);
  if (!result.data) return failure("No se pudo modificar el evento. Actualiza la agenda.", "invalid");
  revalidateEvents();
  return success("Los cambios del evento quedaron guardados.", result.data.id);
}

export async function deleteEventAction(eventId: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(eventId)) return failure("El evento indicado no es válido.", "invalid");
  const result = await actor!.supabase.from("events").delete().eq("id", eventId).select("id").maybeSingle();
  if (result.error) return errorFor(result.error);
  if (!result.data) return failure("El evento ya no está disponible. Actualiza la agenda.", "invalid");
  revalidateEvents();
  return success("El evento y su lista de asistencia fueron eliminados.");
}

export type EventAttendee = {
  userId: string;
  name: string;
  status: "going" | "maybe" | "declined";
};

export async function getEventAttendeesAction(eventId: string): Promise<PlatformActionResult & { attendees?: EventAttendee[] }> {
  const { actor, error } = await requireActor(["coordinator", "club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(eventId)) return failure("El evento indicado no es válido.", "invalid");
  const existing = await actor!.supabase.from("events").select("id").eq("id", eventId).maybeSingle();
  if (existing.error) return errorFor(existing.error);
  if (!existing.data) return failure("El evento ya no está disponible.", "invalid");
  const attendees: EventAttendee[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await actor!.supabase.from("event_rsvps")
      .select("user_id,rsvp_status,profile:profiles!event_rsvps_user_id_fkey(display_name)")
      .eq("event_id", eventId).order("user_id").range(offset, offset + 499);
    if (result.error) return errorFor(result.error);
    const rows = (result.data ?? []) as unknown as Array<{
      user_id: string; rsvp_status: EventAttendee["status"];
      profile: { display_name: string | null } | null;
    }>;
    attendees.push(...rows.map(row => ({
      userId: row.user_id, name: row.profile?.display_name?.trim() || "Miembro del club", status: row.rsvp_status,
    })));
    if (rows.length < 500) break;
  }
  attendees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { ...success("Lista de asistencia cargada."), attendees };
}

const auditSummaryColumns = "id,occurred_at,actor_id,actor_name,actor_role,source,schema_name,table_name,operation,record_id,entity_label,changed_fields";

export async function getAuditPageAction(input: AuditFilters, cursor?: AuditCursor | null, sort: AuditSort = defaultAuditSort): Promise<AuditPageResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  const normalized = normalizeAuditQuery(input, cursor, sort);
  if ("error" in normalized) return failure(normalized.error, "invalid");
  const { filters, tables, fromIso, untilIso } = normalized;
  let query = actor!.supabase.from("audit_log").select(auditSummaryColumns)
    .order(normalized.sort.column, { ascending: normalized.sort.direction === "asc" });
  if (normalized.sort.column !== "occurred_at") query = query.order("occurred_at", { ascending: false });
  query = query.order("id", { ascending: false }).limit(51);
  if (tables.length) query = query.in("table_name", [...tables]);
  if (filters.operation !== "all") query = query.eq("operation", filters.operation);
  if (filters.search) query = query.textSearch("search_document", filters.search, { type: "websearch", config: "simple" });
  if (fromIso) query = query.gte("occurred_at", fromIso);
  if (untilIso) query = query.lt("occurred_at", untilIso);
  if (normalized.cursor) query = query.or(auditCursorFilter(normalized.cursor, normalized.sort));
  const result = await query;
  if (result.error) return isMissingSchemaError(result.error)
    ? failure("La auditoría está preparada, pero falta activar su registro en Supabase.", "migration_missing")
    : failure("No se pudo consultar la auditoría. Inténtalo de nuevo.");
  const rows = (result.data ?? []) as AuditEntry[];
  const entries = rows.slice(0, 50);
  const last = entries.at(-1);
  return {
    ok: true, message: "Registro de auditoría cargado.",
    page: { entries, nextCursor: rows.length > 50 && last ? auditPageCursor(last, normalized.sort) : null },
  };
}

export async function getAuditDetailAction(auditId: string): Promise<AuditDetailResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  if (!isUuid(auditId)) return failure("El registro indicado no es válido.", "invalid");
  const result = await actor!.supabase.from("audit_log")
    .select(`${auditSummaryColumns},record_key,before_data,after_data,context,transaction_id`)
    .eq("id", auditId).maybeSingle();
  if (result.error) return errorFor(result.error);
  if (!result.data) return failure("No se encontró este registro de auditoría.", "invalid");
  return { ok: true, message: "Detalle de auditoría cargado.", detail: result.data as AuditDetail };
}

export async function createActivityAction(input: {
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "club_manager", "admin"]);
  if (error) return error;

  const title = cleanText(input?.title, 180);
  const description = optionalText(input?.description, 4000);
  const startsAt = input?.startsAt ? dateToIso(input.startsAt) : null;
  const endsAt = input?.endsAt ? dateToIso(input.endsAt) : null;
  const location = optionalText(input?.location, 300);
  if (!title || (input?.startsAt && !startsAt) || (input?.endsAt && !endsAt)) {
    return failure("Completa el nombre y las fechas válidas de la actividad.", "invalid");
  }
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return failure("La fecha de cierre debe ser posterior al inicio.", "invalid");
  }

  const slug = slugify(title);
  if (!slug) return failure("El nombre no permite crear un enlace válido.", "invalid");
  const { data, error: insertError } = await actor!.supabase
    .from("activities")
    .insert({
      title,
      slug,
      description,
      starts_at: startsAt,
      ends_at: endsAt,
      location,
      created_by: actor!.userId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidatePath("/plataforma");
  return success("La actividad quedó preparada.", data.id);
}

export async function updateTaskStatusAction(
  taskId: string,
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled",
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(taskId) || !["todo", "in_progress", "blocked", "done", "cancelled"].includes(status)) {
    return failure("La tarea indicada no es válida.", "invalid");
  }

  const { data, error: updateError } = await actor!.supabase
    .from("tasks")
    .update({ task_status: status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  return success("La tarea fue actualizada.");
}

export async function createCommitteeAction(input: {
  name: string;
  description?: string;
  members?: Array<{ userId: string; committeeRole: CommitteeRole }>;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;

  const name = cleanText(input?.name, 140);
  const description = optionalText(input?.description, 2000);
  if (!name || name.length < 2) return failure("Escribe un nombre válido para el comité.", "invalid");
  const slug = slugify(name);
  if (!slug) return failure("El nombre no permite crear un enlace válido.", "invalid");

  const membersInput = input?.members ?? [];
  if (!Array.isArray(membersInput) || membersInput.length > 50) {
    return failure("El comité puede comenzar con hasta 50 integrantes.", "invalid");
  }
  const members: Array<{ userId: string; committeeRole: CommitteeRole }> = [];
  for (const member of membersInput) {
    if (!isUuid(member?.userId) || !["member", "chair", "secretary", "treasurer"].includes(member.committeeRole)) {
      return failure("Revisa los integrantes y sus responsabilidades.", "invalid");
    }
    members.push({ userId: member.userId, committeeRole: member.committeeRole });
  }
  if (new Set(members.map((member) => member.userId)).size !== members.length) {
    return failure("Cada integrante solo puede aparecer una vez en el comité.", "invalid");
  }

  if (members.length > 0) {
    const activeMembers = await actor!.supabase
      .from("memberships")
      .select("user_id")
      .eq("membership_status", "active")
      .in("user_id", members.map((member) => member.userId));
    if (activeMembers.error) return errorFor(activeMembers.error);
    if ((activeMembers.data ?? []).length !== members.length) {
      return failure("Solo puedes incluir integrantes con membresía activa.", "invalid");
    }
  }

  const { data: committeeId, error: insertError } = await actor!.supabase.rpc("create_committee_with_members", {
    _name: name,
    _slug: slug,
    _description: description,
    _member_ids: members.map((member) => member.userId),
    _member_roles: members.map((member) => member.committeeRole),
  });
  if (insertError || !committeeId) return errorFor(insertError);

  revalidatePath("/plataforma");
  return success(members.length > 0 ? "El comité y sus integrantes iniciales quedaron guardados." : "El comité quedó creado.", committeeId);
}

export async function assignCommitteeMemberAction(input: {
  committeeId: string;
  userId: string;
  committeeRole: "member" | "chair" | "secretary" | "treasurer";
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  if (!isUuid(input?.committeeId) || !isUuid(input?.userId)) {
    return failure("El comité o el integrante indicado no es válido.", "invalid");
  }
  if (!["member", "chair", "secretary", "treasurer"].includes(input.committeeRole)) {
    return failure("El cargo dentro del comité no es válido.", "invalid");
  }

  const { data: committee, error: committeeError } = await actor!.supabase
    .from("committees")
    .select("id")
    .eq("id", input.committeeId)
    .eq("is_active", true)
    .maybeSingle();
  if (committeeError) return errorFor(committeeError);
  if (!committee) return failure("No puedes agregar integrantes a un comité terminado.", "invalid");

  const { data: member, error: memberError } = await actor!.supabase
    .from("memberships")
    .select("user_id")
    .eq("user_id", input.userId)
    .eq("membership_status", "active")
    .maybeSingle();
  if (memberError) return errorFor(memberError);
  if (!member) {
    return failure("Solo puedes asignar integrantes con membresía activa.", "invalid");
  }

  const { error: insertError } = await actor!.supabase.from("committee_members").upsert(
    {
      committee_id: input.committeeId,
      user_id: input.userId,
      committee_role: input.committeeRole,
    },
    { onConflict: "committee_id,user_id" },
  );
  if (insertError) return errorFor(insertError);

  revalidatePath("/plataforma");
  return success("La estructura del comité fue actualizada.");
}

export async function updateCommitteeAction(input: {
  committeeId: string;
  name: string;
  description?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  if (!isUuid(input?.committeeId)) return failure("El comité indicado no es válido.", "invalid");

  const name = cleanText(input?.name, 140);
  const description = optionalText(input?.description, 2000);
  if (!name || name.length < 2) return failure("Escribe un nombre válido para el comité.", "invalid");

  const { data, error: updateError } = await actor!.supabase
    .from("committees")
    .update({ name, description, updated_by: actor!.userId })
    .eq("id", input.committeeId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();
  if (updateError) return errorFor(updateError);
  if (!data) return failure("El comité ya no está disponible. Actualiza la organización.", "invalid");

  revalidatePath("/plataforma");
  return success("Los datos del comité fueron actualizados.");
}

export async function completeCommitteeAction(committeeId: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  if (!isUuid(committeeId)) return failure("El comité indicado no es válido.", "invalid");

  const { data, error: updateError } = await actor!.supabase
    .from("committees")
    .update({ is_active: false, updated_by: actor!.userId })
    .eq("id", committeeId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();
  if (updateError) return errorFor(updateError);
  if (!data) return failure("El comité ya está terminado o no está disponible.", "invalid");

  revalidatePath("/plataforma");
  return success("El comité quedó terminado y su historial se conservó.");
}

export async function removeCommitteeMemberAction(input: {
  committeeId: string;
  userId: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["admin"]);
  if (error) return error;
  if (!isUuid(input?.committeeId) || !isUuid(input?.userId)) {
    return failure("El comité o el integrante indicado no es válido.", "invalid");
  }

  const { data: committee, error: committeeError } = await actor!.supabase
    .from("committees")
    .select("id")
    .eq("id", input.committeeId)
    .eq("is_active", true)
    .maybeSingle();
  if (committeeError) return errorFor(committeeError);
  if (!committee) return failure("No puedes cambiar la lista de un comité terminado.", "invalid");

  const { data, error: deleteError } = await actor!.supabase
    .from("committee_members")
    .delete()
    .eq("committee_id", input.committeeId)
    .eq("user_id", input.userId)
    .select("user_id")
    .maybeSingle();
  if (deleteError) return errorFor(deleteError);
  if (!data) return failure("El integrante ya no está asignado a este comité.", "invalid");

  revalidatePath("/plataforma");
  return success("El integrante fue retirado del comité.");
}

export async function createStoryAction(input: {
  storyId?: string;
  title: string;
  excerpt?: string;
  content: string;
  storyType: string;
  status?: "draft" | "published";
  isPublic?: boolean;
  coverImagePath?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["editor", "club_manager", "admin"]);
  if (error) return error;

  const title = cleanText(input?.title, 180);
  const excerpt = optionalText(input?.excerpt, 1000);
  const content = typeof input?.content === "string" ? input.content.trim() : "";
  const storyType = ["cronica", "voces", "archivo", "noticia", "otro"].includes(input?.storyType)
    ? input.storyType
    : "cronica";
  const status = input?.status === "published" ? "published" : "draft";
  const coverImagePath = optionalText(input?.coverImagePath, 500);
  const editorial = parseEditorialContent(content);
  if (!title || title.length < 3 || content.length > MAX_EDITORIAL_CONTENT_LENGTH || !editorial || (input?.storyId !== undefined && !isUuid(input.storyId))) {
    return failure("Completa el título, el texto y las imágenes válidas para una plantilla editorial.", "invalid");
  }
  if (editorial.inlineImagePath && !editorial.inlineImageAlt.trim()) {
    return failure("Describe la fotografía dentro del texto antes de guardar.", "invalid");
  }
  if (status === "published" && !canPublish(actor!.role)) {
    return failure("Tu rol puede preparar la publicación, pero un editor o gestor debe publicarla.", "forbidden");
  }
  let existing: { id: string; slug: string; published_at: string | null; cover_image_path: string | null } | null = null;
  if (input.storyId) {
    const { data, error: readError } = await actor!.supabase
      .from("stories")
      .select("id,slug,published_at,cover_image_path")
      .eq("id", input.storyId)
      .maybeSingle();
    if (readError) return errorFor(readError);
    if (!data) return failure("Esta publicación ya no está disponible. Actualiza la página y vuelve a intentar.", "invalid");
    existing = data;
  }
  if (coverImagePath && !isStoryAssetPath(coverImagePath) && coverImagePath !== existing?.cover_image_path) {
    return failure("Selecciona una fotografía válida para esta publicación.", "invalid");
  }
  // Preserve links and original publication date when editing an existing article.
  const slug = existing?.slug ?? slugify(title);
  if (!slug) return failure("El título no permite crear un enlace válido.", "invalid");

  const values = {
    title, excerpt, content, story_type: storyType, status,
    is_public: status === "published" && Boolean(input?.isPublic),
    published_at: status === "published" ? existing?.published_at ?? new Date().toISOString() : null,
    cover_image_path: coverImagePath,
  };
  const query = existing
    ? actor!.supabase.from("stories").update(values).eq("id", existing.id)
    : actor!.supabase.from("stories").insert({ ...values, slug, author_id: actor!.userId, created_by: actor!.userId });
  const { data, error: writeError } = await query.select("id").maybeSingle();
  if (writeError || !data) return errorFor(writeError);

  revalidatePath("/plataforma");
  revalidatePath("/");
  revalidatePath("/revista");
  revalidatePath(`/revista/${slug}`);
  return success(existing ? "Los cambios de la publicación quedaron guardados." : status === "published" ? "La historia fue publicada." : "La historia quedó como borrador.", data.id);
}

export async function setStoryPublicationAction(
  storyId: string,
  published: boolean,
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["editor", "club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(storyId)) return failure("La publicación indicada no es válida.", "invalid");

  const { data, error: updateError } = await actor!.supabase
    .from("stories")
    .update({
      status: published ? "published" : "draft",
      is_public: published,
      published_at: published ? new Date().toISOString() : null,
      updated_by: actor!.userId,
    })
    .eq("id", storyId)
    .select("id,slug")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  revalidatePath("/");
  revalidatePath("/revista");
  revalidatePath(`/revista/${data.slug}`);
  return success(published ? "La historia ya es visible en el sitio." : "La historia volvió a borrador.");
}

export type MembershipPhotoSlotsActionResult = {
  ok: boolean;
  message: string;
  slots: MembershipPhotoSlotRecord[];
  code?: ActionCode;
};

export type MembershipPhotoSlotRecord = {
  key: MembershipPhotoSlotKey;
  order: number;
  imagePath: string | null;
  imageUrl: string | null;
  altText: string;
  caption: string | null;
  isPublished: boolean;
  updatedAt: string | null;
};

type MembershipPhotoSlotRow = {
  slot_key: MembershipPhotoSlotKey;
  image_path: string | null;
  alt_text: string;
  caption: string | null;
  is_published: boolean;
  updated_at: string;
  display_order: number;
};

export async function getMembershipPhotoSlotsAction(): Promise<MembershipPhotoSlotsActionResult> {
  const { actor, error } = await requireActor(["editor", "club_manager", "admin"]);
  if (error) return { ok: false, message: error.message, slots: [], code: error.code };

  const { data, error: queryError } = await actor!.supabase
    .from("site_photo_slots")
    .select("slot_key,display_order,image_path,alt_text,caption,is_published,updated_at")
    .order("display_order", { ascending: true });
  if (queryError) {
    const result = errorFor(queryError);
    return { ok: false, message: result.message, slots: [], code: result.code };
  }

  const rows = (data ?? []) as MembershipPhotoSlotRow[];
  const slots = rows.map((row) => ({
      key: row.slot_key,
      order: row.display_order,
      imagePath: row.image_path,
      imageUrl: row.image_path
        ? actor!.supabase.storage.from("club-public").getPublicUrl(row.image_path).data.publicUrl
        : null,
      altText: row.alt_text,
      caption: row.caption,
      isPublished: row.is_published,
      updatedAt: row.updated_at,
    } satisfies MembershipPhotoSlotRecord));

  return { ok: true, message: "", slots };
}

export async function updateMembershipPhotoSlotAction(input: {
  slotKey: unknown;
  imagePath: unknown;
  altText: unknown;
  caption: unknown;
  isPublished: unknown;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["editor", "club_manager", "admin"]);
  if (error) return error;
  if (!isMembershipPhotoSlotKey(input?.slotKey) || typeof input?.isPublished !== "boolean") {
    return failure("El espacio fotográfico indicado no es válido.", "invalid");
  }

  const slotKey = input.slotKey;
  const imagePath = typeof input.imagePath === "string" && input.imagePath.trim()
    ? input.imagePath.trim()
    : null;
  const altText = typeof input.altText === "string" ? input.altText.trim() : "";
  const caption = input.caption === null || input.caption === ""
    ? null
    : typeof input.caption === "string"
      ? input.caption.trim() || null
      : undefined;

  if (
    caption === undefined ||
    altText.length > 250 ||
    (caption !== null && caption.length > 300) ||
    (imagePath !== null && (!isMembershipPhotoAssetPath(imagePath, slotKey) || altText.length === 0)) ||
    (input.isPublished && imagePath === null)
  ) {
    return failure("Revisa la foto, su descripción accesible y el pie de foto.", "invalid");
  }

  const { data: current, error: currentError } = await actor!.supabase
    .from("site_photo_slots")
    .select("image_path")
    .eq("slot_key", slotKey)
    .maybeSingle();
  if (currentError) return errorFor(currentError);
  if (!current) return failure("El espacio fotográfico ya no existe. Actualiza la plataforma.", "invalid");

  const { data: updated, error: updateError } = await actor!.supabase
    .from("site_photo_slots")
    .update({
      image_path: imagePath,
      alt_text: altText,
      caption,
      is_published: input.isPublished,
      updated_by: actor!.userId,
    })
    .eq("slot_key", slotKey)
    .select("slot_key")
    .maybeSingle();
  if (updateError || !updated) return errorFor(updateError);

  let message = input.isPublished ? "La foto ya está publicada." : "Se guardaron los cambios de la foto.";
  if (
    typeof current.image_path === "string" &&
    current.image_path !== imagePath &&
    isMembershipPhotoAssetPath(current.image_path, slotKey)
  ) {
    const { error: removeError } = await actor!.supabase.storage
      .from("club-public")
      .remove([current.image_path]);
    if (removeError) message = "La foto se actualizó, pero no se pudo retirar el archivo anterior.";
  }

  revalidatePath("/plataforma");
  revalidatePath("/solicitar-membresia");
  return success(message);
}

export async function updateMembershipAction(input: {
  userId: string;
  status: MembershipStatus;
  role: PlatformRole;
}): Promise<PlatformActionResult> {
  return updateMemberAccessAction(input);
}

export type MembershipApplicationsActionResult = {
  ok: boolean;
  message: string;
  applications: MembershipApplication[];
  code?: ActionCode;
};

export async function getMembershipApplicationsAction(): Promise<MembershipApplicationsActionResult> {
  const { actor, error } = await requireActor();
  if (error) return { ok: false, message: error.message, applications: [], code: error.code };

  const { data, error: queryError } = await actor!.supabase
    .from("membership_applications")
    .select("id,full_name,email,phone,occupation,motivation,referral_source,status,submitted_at,updated_at")
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (queryError) return { ok: false, message: errorFor(queryError).message, applications: [] };

  return { ok: true, message: "", applications: (data ?? []) as MembershipApplication[] };
}

export async function updateMembershipApplicationStatusAction(
  applicationId: string,
  status: MembershipApplicationStatus,
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(applicationId) || !["new", "contacted", "invited", "declined"].includes(status)) {
    return failure("La solicitud indicada o su estado no son válidos.", "invalid");
  }

  const { data, error: updateError } = await actor!.supabase
    .from("membership_applications")
    .update({ status, reviewed_by: actor!.userId })
    .eq("id", applicationId)
    .select("id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  return success("El seguimiento de la solicitud fue actualizado.");
}

export async function sendInternalMessageAction(input: {
  recipientUserId: string;
  subject: string;
  body: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;

  const subject = cleanText(input?.subject, 180);
  const body = cleanText(input?.body, 8000);
  if (!subject || subject.length < 3 || !body) {
    return failure("Escribe un asunto y un mensaje.", "invalid");
  }

  const isBroadcast = input?.recipientUserId === "all";
  let recipientIds: string[] = [];
  if (isBroadcast) {
    if (!["coordinator", "club_manager", "admin"].includes(actor!.role)) {
      return failure("Solo coordinación y gestión pueden enviar avisos al club completo.", "forbidden");
    }
    const { data: directory, error: directoryError } = await actor!.supabase
      .from("memberships")
      .select("user_id")
      .eq("membership_status", "active")
      .limit(500);
    if (directoryError) return errorFor(directoryError);
    recipientIds = ((directory ?? []) as Array<{ user_id: string }>)
      .map((member) => member.user_id)
      .filter((id) => id !== actor!.userId);
  } else if (isUuid(input?.recipientUserId)) {
    recipientIds = [input.recipientUserId];
  } else {
    return failure("El destinatario indicado no es válido.", "invalid");
  }

  if (recipientIds.length === 0) {
    return failure("No encontramos destinatarios con membresía activa.", "invalid");
  }

  const { data: messageId, error: sendError } = await actor!.supabase.rpc("send_internal_message", {
    _recipient_ids: recipientIds,
    _subject: subject,
    _body: body,
    _audience_type: isBroadcast ? "all_members" : "direct",
  });
  if (sendError || !messageId) return errorFor(sendError);

  revalidatePath("/plataforma");
  return success(isBroadcast ? "El aviso fue enviado al club." : "El mensaje fue enviado.", messageId);
}

export async function markMessageReadAction(messageId: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(messageId)) return failure("El mensaje indicado no es válido.", "invalid");

  const { data, error: updateError } = await actor!.supabase
    .from("internal_message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("user_id", actor!.userId)
    .select("message_id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  return success("Mensaje marcado como leído.");
}

export async function markNotificationReadAction(notificationId: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(notificationId)) return failure("El aviso indicado no es válido.", "invalid");

  const { data, error: updateError } = await actor!.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", actor!.userId)
    .select("id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  return success("Aviso marcado como leído.");
}
