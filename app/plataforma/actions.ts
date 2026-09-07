"use server";

import { revalidatePath } from "next/cache";

import { isMissingSchemaError } from "@/lib/platform";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

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

export async function rsvpEventAction(
  eventId: string,
  status: "going" | "maybe" | "declined",
): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor();
  if (error) return error;
  if (!isUuid(eventId) || !["going", "maybe", "declined"].includes(status)) {
    return failure("La asistencia indicada no es válida.", "invalid");
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

export async function createEventAction(input: {
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
  status?: "draft" | "published";
  isPublic?: boolean;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "editor", "club_manager", "admin"]);
  if (error) return error;

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
  const status = input?.status === "published" ? "published" : "draft";
  const isPublic = Boolean(input?.isPublic);

  if (!title || !startsAt || (input?.endsAt && !endsAt)) {
    return failure("Completa el título y una fecha válida para el evento.", "invalid");
  }
  if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return failure("La fecha de cierre debe ser posterior al inicio.", "invalid");
  }
  if (locationUrl && !/^https?:\/\//i.test(locationUrl)) {
    return failure("El enlace de ubicación debe comenzar con https:// o http://.", "invalid");
  }
  const numericCapacity =
    input?.capacity === undefined || input.capacity === "" ? null : Number(input.capacity);
  if (numericCapacity !== null && (!Number.isInteger(numericCapacity) || numericCapacity < 0)) {
    return failure("La capacidad debe ser un número entero positivo.", "invalid");
  }
  if (status === "published" && !canPublish(actor!.role)) {
    return failure("Tu rol puede preparar el evento, pero un editor o gestor debe publicarlo.", "forbidden");
  }

  const slug = slugify(title);
  if (!slug) return failure("El título no permite crear un enlace válido.", "invalid");

  const { data, error: insertError } = await actor!.supabase
    .from("events")
    .insert({
      title,
      slug,
      summary,
      description,
      kind,
      tone: kind === "servicio" ? "sun" : kind === "reunion" ? "coral" : "lime",
      starts_at: startsAt,
      ends_at: endsAt,
      venue_name: venueName,
      venue_address: venueAddress,
      location_url: locationUrl,
      capacity: numericCapacity,
      status,
      is_public: status === "published" && isPublic,
      created_by: actor!.userId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidatePath("/plataforma");
  revalidatePath("/");
  return success(status === "published" ? "El evento fue publicado." : "El evento quedó guardado como borrador.", data.id);
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
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "club_manager", "admin"]);
  if (error) return error;

  const name = cleanText(input?.name, 140);
  const description = optionalText(input?.description, 2000);
  if (!name || name.length < 2) return failure("Escribe un nombre válido para el comité.", "invalid");
  const slug = slugify(name);
  if (!slug) return failure("El nombre no permite crear un enlace válido.", "invalid");

  const { data, error: insertError } = await actor!.supabase
    .from("committees")
    .insert({ name, slug, description, created_by: actor!.userId })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidatePath("/plataforma");
  return success("El comité quedó creado.", data.id);
}

export async function assignCommitteeMemberAction(input: {
  committeeId: string;
  userId: string;
  committeeRole: "member" | "chair" | "secretary" | "treasurer";
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["coordinator", "club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(input?.committeeId) || !isUuid(input?.userId)) {
    return failure("El comité o el integrante indicado no es válido.", "invalid");
  }
  if (!["member", "chair", "secretary", "treasurer"].includes(input.committeeRole)) {
    return failure("El cargo dentro del comité no es válido.", "invalid");
  }

  const { data: member, error: memberError } = await actor!.supabase
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();
  if (memberError || !member) {
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

export async function createStoryAction(input: {
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
  if (!title || title.length < 3 || content.length > 20000) {
    return failure("Completa el título y un contenido de hasta 20,000 caracteres.", "invalid");
  }
  if (status === "published" && !canPublish(actor!.role)) {
    return failure("Tu rol puede preparar la publicación, pero un editor o gestor debe publicarla.", "forbidden");
  }
  const slug = slugify(title);
  if (!slug) return failure("El título no permite crear un enlace válido.", "invalid");

  const { data, error: insertError } = await actor!.supabase
    .from("stories")
    .insert({
      title,
      slug,
      excerpt,
      content,
      story_type: storyType,
      status,
      is_public: status === "published" && Boolean(input?.isPublic),
      published_at: status === "published" ? new Date().toISOString() : null,
      cover_image_path: coverImagePath,
      author_id: actor!.userId,
      created_by: actor!.userId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data) return errorFor(insertError);

  revalidatePath("/plataforma");
  revalidatePath("/");
  return success(status === "published" ? "La historia fue publicada." : "La historia quedó como borrador.", data.id);
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
    .select("id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  revalidatePath("/");
  return success(published ? "La historia ya es visible en el sitio." : "La historia volvió a borrador.");
}

export async function updateMembershipAction(input: {
  userId: string;
  status: MembershipStatus;
  role: PlatformRole;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireActor(["club_manager", "admin"]);
  if (error) return error;
  if (!isUuid(input?.userId) || !["pending", "active", "suspended"].includes(input.status)) {
    return failure("La membresía indicada no es válida.", "invalid");
  }
  if (!["member", "coordinator", "editor", "club_manager", "admin"].includes(input.role)) {
    return failure("El rol indicado no es válido.", "invalid");
  }
  if (input.userId === actor!.userId) {
    return failure("La cuenta actual no puede cambiar su propio acceso.", "forbidden");
  }

  const now = new Date().toISOString();
  const { data, error: updateError } = await actor!.supabase
    .from("memberships")
    .update({
      membership_status: input.status,
      membership_role: input.role,
      approved_by: input.status === "active" ? actor!.userId : null,
      approved_at: input.status === "active" ? now : null,
      joined_at: input.status === "active" ? now : null,
    })
    .eq("user_id", input.userId)
    .select("user_id")
    .maybeSingle();
  if (updateError || !data) return errorFor(updateError);

  revalidatePath("/plataforma");
  return success(
    input.status === "active"
      ? "La membresía fue activada."
      : input.status === "suspended"
        ? "La membresía fue suspendida."
        : "La solicitud volvió a pendiente.",
  );
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
