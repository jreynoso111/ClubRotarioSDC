"use server";

import { revalidatePath } from "next/cache";
import { memberApprovedEmail, memberReactivatedEmail, memberRoleChangedEmail, memberSuspendedEmail, sendClubEmail, type ClubEmailContent } from "@/lib/email";
import { memberNotesMaxLength, memberReasonRange, memberStatuses, partitionClubAccounts, platformRoleLabels, platformRoles, type MemberStatus } from "@/lib/member-access";
import { avatarVersion } from "@/lib/account";
import type { MembershipApplicationStatus } from "@/lib/membership-applications";
import type { PlatformRole } from "@/lib/platform";
import { readEveryPage } from "@/lib/read-every-page";
import { getPublicSiteOrigin } from "@/utils/site-url";
import type { PlatformActionResult } from "./actions";
import { moduleFailure, requireModuleActor, validUuid } from "./module-auth";

type ModuleActor = NonNullable<Awaited<ReturnType<typeof requireModuleActor>>["actor"]>;
type RpcError = { code?: string | null; message?: string | null; details?: string | null };

const managementRoles: PlatformRole[] = ["club_manager", "admin"];

export type ManagedMember = {
  userId: string;
  name: string;
  bio: string | null;
  role: PlatformRole;
  status: MemberStatus;
  notes: string | null;
  joinedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Editors with this flag may publish in the magazine; management and admins always may.
  canPublishStories: boolean;
  // Cache-busting version of the profile photo; null when the member has no photo.
  avatarVersion: string | null;
};

export type PendingMember = {
  userId: string;
  name: string;
  email: string | null;
  emailConfirmed: boolean;
  registeredAt: string;
  applicationId: string | null;
  applicationStatus: MembershipApplicationStatus | null;
  applicationFullName: string | null;
};

export type MemberAccessHistoryEntry = {
  fromRole: PlatformRole | null;
  toRole: PlatformRole;
  fromStatus: MemberStatus | null;
  toStatus: MemberStatus;
  reason: string | null;
  actorName: string;
  createdAt: string;
};

type MembershipListRow = {
  user_id: string;
  membership_role: PlatformRole;
  membership_status: MemberStatus;
  joined_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  can_publish_stories: boolean;
};
type ProfileRow = { id: string; display_name: string | null; bio: string | null; avatar_path: string | null; updated_at: string | null };
type NoteRow = { user_id: string; notes: string | null };
type PendingRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  email_confirmed: boolean;
  registered_at: string;
  application_id: string | null;
  application_status: MembershipApplicationStatus | null;
  application_full_name: string | null;
};
type AccessRow = { email: string | null; display_name: string | null; previous_role: PlatformRole; previous_status: MemberStatus };
type HistoryRow = {
  from_role: PlatformRole | null;
  to_role: PlatformRole;
  from_status: MemberStatus | null;
  to_status: MemberStatus;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
};

function fallbackName(name: string | null | undefined) {
  return name?.trim() || "Miembro del club";
}

function errorText(error: RpcError) {
  return `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
}

// Notes are management-only (column privilege), so they come from their own RPC, in batches.
async function readMembershipNotes(supabase: ModuleActor["supabase"], userIds: string[]) {
  const notes = new Map<string, string | null>();
  for (let index = 0; index < userIds.length; index += 200) {
    const { data, error } = await supabase.rpc("get_membership_notes", { _user_ids: userIds.slice(index, index + 200) });
    if (error) return null;
    for (const row of (data ?? []) as NoteRow[]) notes.set(row.user_id, row.notes);
  }
  return notes;
}

function accessFailure(error: RpcError): PlatformActionResult {
  const text = errorText(error);
  if (error.code === "P0409" || text.includes("stale_member")) return moduleFailure("Otra persona cambió este miembro. Recarga para ver los cambios.", "conflict");
  if (error.code === "P0410" || text.includes("last_admin")) return moduleFailure("El club debe conservar al menos un administrador activo.", "invalid");
  if (text.includes("reason_required")) return moduleFailure(`Indica el motivo (${memberReasonRange.min} a ${memberReasonRange.max} caracteres) para suspender o cambiar el rol.`, "invalid");
  if (error.code === "42501") return moduleFailure("No tienes permiso para cambiar este acceso. Solo un administrador puede asignar roles de administración o modificar cuentas administradoras, y nadie puede cambiar su propio acceso.", "forbidden");
  if (error.code === "22023") return moduleFailure("Revisa el miembro, el acceso, las notas y el motivo.", "invalid");
  return moduleFailure("No se pudo guardar el acceso. Recarga la ficha e inténtalo de nuevo.");
}

function rejectFailure(error: RpcError): PlatformActionResult {
  const text = errorText(error);
  if (error.code === "42501") return moduleFailure("No tienes permiso para rechazar esta cuenta.", "forbidden");
  if (text.includes("not_pending")) return moduleFailure("Esta cuenta ya no está pendiente de aprobación. Recarga la lista.", "conflict");
  if (text.includes("member_has_activity")) return moduleFailure("La cuenta ya tiene actividad en la plataforma, así que no puede eliminarse. Gestiona su acceso desde su ficha.", "invalid");
  if (error.code === "22023" && text.includes("reason")) return moduleFailure(`Indica el motivo del rechazo (${memberReasonRange.min} a ${memberReasonRange.max} caracteres).`, "invalid");
  return moduleFailure("No se pudo rechazar la cuenta. Vuelve a intentar.");
}

// Emails follow the change that actually happened; notes-only edits send nothing.
function accessMessages(row: AccessRow, status: MemberStatus, role: PlatformRole, reason: string): ClubEmailContent[] {
  const name = fallbackName(row.display_name);
  const platformUrl = `${getPublicSiteOrigin()}/plataforma`;
  const messages: ClubEmailContent[] = [];
  const statusChanged = row.previous_status !== status;
  if (statusChanged && status === "active" && row.previous_status === "pending") messages.push(memberApprovedEmail(name, platformUrl));
  if (statusChanged && status === "active" && row.previous_status === "suspended") messages.push(memberReactivatedEmail(name, platformUrl));
  if (statusChanged && status === "suspended") messages.push(memberSuspendedEmail(name, reason));
  if (status === "active" && row.previous_role !== role) messages.push(memberRoleChangedEmail(name, platformRoleLabels[role]));
  return messages;
}

export async function listManagedMembersAction(): Promise<PlatformActionResult & { members?: ManagedMember[]; administrativeAccounts?: ManagedMember[]; actorRole?: PlatformRole }> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  try {
    const [memberships, profiles] = await Promise.all([
      readEveryPage<MembershipListRow, unknown>((first, last) => actor.supabase.from("memberships")
        .select("user_id,membership_role,membership_status,joined_at,approved_at,created_at,updated_at,can_publish_stories")
        .order("created_at", { ascending: false }).order("user_id").range(first, last)),
      readEveryPage<ProfileRow, unknown>((first, last) => actor.supabase.from("profiles").select("id,display_name,bio,avatar_path,updated_at")
        .order("id").range(first, last)),
    ]);
    if (memberships.error || profiles.error) return moduleFailure("No se pudo cargar el registro de miembros. Vuelve a intentar.");
    const notes = await readMembershipNotes(actor.supabase, memberships.data.map(row => row.user_id));
    if (!notes) return moduleFailure("No se pudo cargar las notas internas. Vuelve a intentar.");
    const profileById = new Map(profiles.data.map(profile => [profile.id, profile]));
    const accounts = partitionClubAccounts(memberships.data.map(row => ({
      userId: row.user_id, name: fallbackName(profileById.get(row.user_id)?.display_name),
      bio: profileById.get(row.user_id)?.bio ?? null, role: row.membership_role, status: row.membership_status,
      notes: notes.get(row.user_id) ?? null, joinedAt: row.joined_at, approvedAt: row.approved_at,
      createdAt: row.created_at, updatedAt: row.updated_at, canPublishStories: row.can_publish_stories === true,
      avatarVersion: avatarVersion(profileById.get(row.user_id)?.avatar_path, profileById.get(row.user_id)?.updated_at),
    })));
    return {
      ok: true, message: "Miembros cargados.", actorRole: actor.role,
      members: accounts.members,
      administrativeAccounts: actor.role === "admin" ? accounts.administrativeAccounts : [],
    };
  } catch {
    return moduleFailure("No se pudo cargar el registro de miembros. Vuelve a intentar.");
  }
}

// Management-only list of accounts waiting for approval; the database decides who is pending.
export async function listPendingMembersAction(): Promise<PlatformActionResult & { members?: PendingMember[] }> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  const { data, error: rpcError } = await actor.supabase.rpc("list_pending_members");
  if (rpcError) return moduleFailure("No se pudieron cargar las cuentas pendientes. Vuelve a intentar.");
  return {
    ok: true, message: "Cuentas pendientes cargadas.",
    members: ((data ?? []) as PendingRow[]).map(row => ({
      userId: row.user_id, name: fallbackName(row.display_name), email: row.email, emailConfirmed: row.email_confirmed,
      registeredAt: row.registered_at, applicationId: row.application_id, applicationStatus: row.application_status,
      applicationFullName: row.application_full_name,
    })),
  };
}

// Approving a pending account is this same action with status active and role member.
export async function updateMemberAccessAction(input: {
  userId: string;
  status: MemberStatus;
  role: PlatformRole;
  notes?: string;
  reason?: string;
  expectedUpdatedAt: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (!validUuid(input?.userId) || !memberStatuses.includes(input?.status) || !platformRoles.includes(input?.role)
    || (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.trim().length > memberNotesMaxLength))
    || (input.reason !== undefined && (typeof input.reason !== "string" || reason.length > memberReasonRange.max))
    || typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    return moduleFailure("Revisa el miembro, el acceso, las notas y el motivo.", "invalid");
  }
  if (input.userId === actor.userId) return moduleFailure("Tu cuenta actual conserva su acceso. Otro administrador debe cambiarlo.", "forbidden");

  let notes = input.notes;
  if (notes === undefined) {
    // Without new notes the stored text is sent back unchanged, so nothing is lost.
    const current = await readMembershipNotes(actor.supabase, [input.userId]);
    if (!current) return moduleFailure("No se pudo cargar el acceso del miembro. Vuelve a intentar.");
    notes = current.get(input.userId) ?? "";
  }
  // A reason shorter than the minimum is not sent; the database then asks for one when it is required.
  const { data, error: rpcError } = await actor.supabase.rpc("update_member_access", {
    _user_id: input.userId, _role: input.role, _status: input.status, _notes: notes.trim() || null,
    _reason: reason.length >= memberReasonRange.min ? reason : null, _expected_updated_at: input.expectedUpdatedAt,
  });
  if (rpcError) return accessFailure(rpcError);
  const row = (Array.isArray(data) ? data[0] : data) as AccessRow | null | undefined;
  if (!row) return moduleFailure("El miembro ya no está disponible.", "conflict");

  const messages = accessMessages(row, input.status, input.role, reason);
  const recipient = row.email?.trim() ?? "";
  let emailNote = "";
  if (messages.length > 0) {
    if (!recipient) {
      emailNote = " No se envió correo porque la cuenta no tiene un correo registrado.";
    } else {
      const sent = await Promise.all(messages.map(message => sendClubEmail({ to: recipient, ...message })));
      emailNote = sent.every(Boolean) ? " Se envió un correo al miembro." : " No se pudo enviar el correo al miembro; el cambio sí quedó guardado.";
    }
  }
  revalidatePath("/plataforma");
  return { ok: true, message: `El acceso y las notas del miembro quedaron guardados.${emailNote}` };
}

function storyPublisherFailure(error: RpcError): PlatformActionResult {
  const text = errorText(error);
  if (error.code === "42501") return moduleFailure("Solo la gestión del club puede dar o quitar el permiso para publicar en la Revista.", "forbidden");
  if (error.code === "22023" && text.includes("not_editor")) return moduleFailure("Solo se puede dar permiso de publicación a una persona con rol de edición activo.", "invalid");
  if (error.code === "22023") return moduleFailure("No se puede cambiar este permiso. Revisa la persona indicada.", "invalid");
  return moduleFailure("No se pudo cambiar el permiso de publicación. Vuelve a intentar.");
}

// Management grants or removes the magazine publishing flag of an active editor. The database checks the target and refuses self-changes.
export async function setStoryPublisherAction(userId: string, enabled: boolean): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  if (!validUuid(userId) || typeof enabled !== "boolean") return moduleFailure("Elige una persona editora y si puede publicar.", "invalid");
  if (userId === actor.userId) return moduleFailure("No puedes cambiar tu propio permiso de publicación.", "forbidden");
  const { error: rpcError } = await actor.supabase.rpc("set_story_publisher", { _user_id: userId, _enabled: enabled });
  if (rpcError) return storyPublisherFailure(rpcError);
  revalidatePath("/plataforma");
  return {
    ok: true,
    message: enabled
      ? "La persona editora ya puede publicar en la Revista."
      : "La persona editora ya no puede publicar en la Revista.",
  };
}

// Deletes a pending account and keeps a rejection record. The database checks that the account is still pending.
export async function rejectPendingMemberAction(userId: string, reason: string): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!validUuid(userId) || text.length < memberReasonRange.min || text.length > memberReasonRange.max) {
    return moduleFailure(`Indica el motivo del rechazo (${memberReasonRange.min} a ${memberReasonRange.max} caracteres).`, "invalid");
  }
  const { error: rpcError } = await actor.supabase.rpc("reject_pending_member", { _user_id: userId, _reason: text });
  if (rpcError) return rejectFailure(rpcError);
  revalidatePath("/plataforma");
  return { ok: true, message: "La cuenta pendiente se eliminó y quedó un registro del rechazo." };
}

export async function getMemberAccessHistoryAction(userId: string): Promise<PlatformActionResult & { history?: MemberAccessHistoryEntry[] }> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  if (!validUuid(userId)) return moduleFailure("El miembro indicado no es válido.", "invalid");
  try {
    const history = await readEveryPage<HistoryRow, unknown>((first, last) => actor.supabase.from("membership_access_history")
      .select("from_role,to_role,from_status,to_status,reason,actor_id,created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).range(first, last));
    if (history.error) return moduleFailure("No se pudo cargar el historial de acceso. Vuelve a intentar.");
    const actorIds = [...new Set(history.data.map(row => row.actor_id).filter((id): id is string => typeof id === "string"))];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data, error: profilesError } = await actor.supabase.from("profiles").select("id,display_name").in("id", actorIds);
      if (profilesError) return moduleFailure("No se pudo cargar el historial de acceso. Vuelve a intentar.");
      for (const profile of (data ?? []) as Array<{ id: string; display_name: string | null }>) names.set(profile.id, fallbackName(profile.display_name));
    }
    return {
      ok: true, message: "Historial de acceso cargado.",
      history: history.data.map(row => ({
        fromRole: row.from_role, toRole: row.to_role, fromStatus: row.from_status, toStatus: row.to_status,
        reason: row.reason, actorName: row.actor_id ? names.get(row.actor_id) ?? "Miembro del club" : "Club Rotario",
        createdAt: row.created_at,
      })),
    };
  } catch {
    return moduleFailure("No se pudo cargar el historial de acceso. Vuelve a intentar.");
  }
}

export async function updateMemberProfileAction(input: { userId: string; name: string; bio?: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(managementRoles);
  if (error || !actor) return error!;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const bio = typeof input?.bio === "string" ? input.bio.trim() : "";
  if (!validUuid(input?.userId) || name.length < 2 || name.length > 120 || bio.length > 4000) return moduleFailure("Escribe un nombre válido y una descripción de hasta 4,000 caracteres.", "invalid");
  // Club managers edit their own profile and ordinary accounts; administrator accounts are administrators' to edit.
  if (actor.role !== "admin" && input.userId !== actor.userId) {
    const { data: target, error: targetError } = await actor.supabase.from("memberships").select("membership_role")
      .eq("user_id", input.userId).maybeSingle();
    if (targetError) return moduleFailure("No se pudo verificar la ficha del miembro. Vuelve a intentar.");
    if (target && ["admin", "club_manager"].includes(target.membership_role)) return moduleFailure("Solo un administrador puede modificar esta cuenta.", "forbidden");
  }
  const { data, error: updateError } = await actor.supabase.from("profiles").update({ display_name: name, bio: bio || null }).eq("id", input.userId).select("id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo actualizar la ficha del miembro.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La ficha del miembro quedó actualizada." };
}
