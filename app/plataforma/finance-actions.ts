"use server";

import { revalidatePath } from "next/cache";
import type { FinanceLedgerEntry, FinancePaymentMethod, FinanceCategory, FinanceStatement, FinanceYearMonth } from "@/lib/finance";
import { financeCategoryLabels, financePaymentMethodLabels } from "@/lib/finance";
import type { PlatformActionResult } from "./actions";
import { moduleFailure, requireModuleActor, validUuid } from "./module-auth";

const ENTRY_COLUMNS = "id,direction,category,amount,occurred_on,description,member_id,member_name_snapshot,counterparty_name,activity_id,activity_name_snapshot,monthly_due_id,payment_method,receipt_reference,voided_at,void_reason,receipt_number,attachment_path";
const managementRoles = ["club_manager", "admin"] as const;
const memberRoles = ["member", "coordinator", "editor", "club_manager", "admin"] as const;

type EntryRow = {
  id: string; direction: string; category: string; amount: string | number; occurred_on: string; description: string;
  member_id: string | null; member_name_snapshot: string | null; counterparty_name: string | null; activity_id: string | null;
  activity_name_snapshot: string | null; monthly_due_id: string | null; payment_method: string; receipt_reference: string | null;
  voided_at: string | null; void_reason: string | null; receipt_number: number | null; attachment_path: string | null;
};

function toEntry(entry: EntryRow): FinanceLedgerEntry {
  return {
    id: entry.id, direction: entry.direction as "income" | "expense", category: entry.category as FinanceCategory,
    amount: String(entry.amount), occurredOn: entry.occurred_on, description: entry.description,
    memberId: entry.member_id, memberName: entry.member_name_snapshot, counterpartyName: entry.counterparty_name,
    activityId: entry.activity_id, activityName: entry.activity_name_snapshot, monthlyDueId: entry.monthly_due_id,
    paymentMethod: entry.payment_method as FinancePaymentMethod, receiptReference: entry.receipt_reference,
    voidedAt: entry.voided_at, voidReason: entry.void_reason, receiptNumber: entry.receipt_number, attachmentPath: entry.attachment_path,
  };
}

function validYear(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 2000 && (value as number) <= 2200;
}

export async function voidFinanceEntryAction(entryId: string, reason: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor([...managementRoles]);
  if (error || !actor) return error!;
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!validUuid(entryId) || text.length < 5 || text.length > 500) return moduleFailure("Explica el motivo de la anulación (5 a 500 caracteres).", "invalid");
  const { error: voidError } = await actor.supabase.rpc("void_finance_entry", { _entry_id: entryId, _reason: text });
  if (voidError) return moduleFailure("No se pudo anular: el movimiento no existe o ya estaba anulado.", "invalid");
  revalidatePath("/plataforma");
  return { ok: true, message: "El movimiento quedó anulado: sigue visible en el libro, pero ya no cuenta en los totales." };
}

export async function getFinanceYearSummaryAction(year: number): Promise<PlatformActionResult & { months?: FinanceYearMonth[] }> {
  const { actor, error } = await requireModuleActor([...managementRoles]);
  if (error || !actor) return error!;
  if (!validYear(year)) return moduleFailure("Selecciona un año válido.", "invalid");
  const { data, error: queryError } = await actor.supabase.rpc("get_finance_year_summary", { _year: year });
  if (queryError) return moduleFailure("No se pudo calcular el resumen anual.");
  const months = ((data ?? []) as Array<{ month_start: string; income: number; expense: number; balance: number; cumulative: number }>)
    .map(row => ({ monthStart: row.month_start, income: String(row.income), expense: String(row.expense), balance: String(row.balance), cumulative: String(row.cumulative) }));
  return { ok: true, message: "Resumen anual cargado.", months };
}

// A member reads their own statement; management may read anyone's.
export async function getFinanceStatementAction(year: number, memberId?: string): Promise<PlatformActionResult & { statement?: FinanceStatement }> {
  const { actor, error } = await requireModuleActor([...memberRoles]);
  if (error || !actor) return error!;
  const isManagement = actor.role === "club_manager" || actor.role === "admin";
  const target = memberId && isManagement ? memberId : actor.userId;
  if (!validYear(year) || !validUuid(target)) return moduleFailure("Revisa el año y el miembro.", "invalid");
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const [dues, entries, profile] = await Promise.all([
    actor.supabase.from("finance_monthly_dues").select("id,due_month,amount_due").eq("member_id", target).gte("due_month", from).lt("due_month", to).order("due_month"),
    actor.supabase.from("finance_entries").select(ENTRY_COLUMNS).eq("member_id", target).eq("direction", "income").gte("occurred_on", from).lt("occurred_on", to).order("occurred_on").limit(1000),
    actor.supabase.from("profiles").select("display_name").eq("id", target).maybeSingle(),
  ]);
  if (dues.error || entries.error) return moduleFailure("No se pudo cargar el estado de cuenta.");
  const payments = ((entries.data ?? []) as EntryRow[]).map(toEntry);
  const paidByDue = new Map<string, number>();
  for (const payment of payments) if (payment.monthlyDueId && !payment.voidedAt) paidByDue.set(payment.monthlyDueId, (paidByDue.get(payment.monthlyDueId) ?? 0) + Number(payment.amount));
  return { ok: true, message: "Estado de cuenta cargado.", statement: {
    year, memberName: profile.data?.display_name?.trim() || "Miembro del club",
    dues: ((dues.data ?? []) as Array<{ id: string; due_month: string; amount_due: number }>).map(due => ({ dueMonth: due.due_month, amountDue: String(due.amount_due), amountPaid: String(paidByDue.get(due.id) ?? 0) })),
    payments,
  } };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportFinanceCsvAction(period: { month?: string; year?: number }): Promise<PlatformActionResult & { csv?: string; fileName?: string }> {
  const { actor, error } = await requireModuleActor([...managementRoles]);
  if (error || !actor) return error!;
  let from: string, to: string, label: string;
  if (period?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month)) {
    const [y, m] = period.month.split("-").map(Number);
    from = `${period.month}-01`; to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); label = period.month;
  } else if (validYear(period?.year)) {
    from = `${period.year}-01-01`; to = `${period.year! + 1}-01-01`; label = String(period.year);
  } else return moduleFailure("Selecciona el mes o el año a exportar.", "invalid");
  const [entries, dues] = await Promise.all([
    actor.supabase.from("finance_entries").select(ENTRY_COLUMNS).gte("occurred_on", from).lt("occurred_on", to).order("occurred_on").order("created_at").limit(10000),
    actor.supabase.rpc("get_finance_month_dues", { _month_start: from }),
  ]);
  if (entries.error) return moduleFailure("No se pudo preparar la exportación.");
  const rows = [["Recibo", "Fecha", "Tipo", "Categoría", "Concepto", "Miembro", "Persona externa", "Actividad", "Ingreso", "Egreso", "Medio", "Referencia", "Estado", "Motivo de anulación"].map(csvCell).join(",")];
  for (const entry of ((entries.data ?? []) as EntryRow[]).map(toEntry)) {
    rows.push([entry.receiptNumber ?? "", entry.occurredOn, entry.direction === "income" ? "Ingreso" : "Egreso", financeCategoryLabels[entry.category], entry.description,
      entry.memberName ?? "", entry.counterpartyName ?? "", entry.activityName ?? "", entry.direction === "income" ? entry.amount : "", entry.direction === "expense" ? entry.amount : "",
      financePaymentMethodLabels[entry.paymentMethod], entry.receiptReference ?? "", entry.voidedAt ? "Anulado" : "Vigente", entry.voidReason ?? ""].map(csvCell).join(","));
  }
  if (period.month && !dues.error) {
    rows.push("", ["Cuotas del mes", "Miembro", "Cuota", "Pagado", "Pendiente"].map(csvCell).join(","));
    for (const due of (dues.data ?? []) as Array<{ member_name: string; amount_due: number; amount_paid: number }>) {
      rows.push(["", due.member_name, due.amount_due, due.amount_paid, Number(due.amount_due) - Number(due.amount_paid)].map(csvCell).join(","));
    }
  }
  // The BOM lets Excel open accents correctly.
  return { ok: true, message: "Exportación preparada.", csv: "﻿" + rows.join("\r\n"), fileName: `finanzas-club-${label}.csv` };
}

export async function attachFinanceReceiptAction(entryId: string, path: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor([...managementRoles]);
  if (error || !actor) return error!;
  if (!validUuid(entryId) || typeof path !== "string" || !path.startsWith(`${entryId}/`)) return moduleFailure("El comprobante no corresponde al movimiento.", "invalid");
  const { error: attachError } = await actor.supabase.rpc("set_finance_entry_attachment", { _entry_id: entryId, _path: path });
  if (attachError) return moduleFailure("No se pudo vincular el comprobante.");
  revalidatePath("/plataforma");
  return { ok: true, message: "El comprobante quedó adjunto al movimiento." };
}
