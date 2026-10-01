"use server";

import { revalidatePath } from "next/cache";
import type { PlatformRole } from "@/lib/platform";
import type { PlatformActionResult } from "./actions";
import { moduleFailure, requireModuleActor, validUuid } from "./module-auth";

export type ManagedMember = {
  userId: string;
  name: string;
  bio: string | null;
  role: PlatformRole;
  status: "pending" | "active" | "suspended";
  notes: string | null;
  joinedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listManagedMembersAction(): Promise<PlatformActionResult & { members?: ManagedMember[]; actorRole?: PlatformRole }> {
  const { actor, error } = await requireModuleActor(["club_manager", "admin"]);
  if (error || !actor) return error!;
  const results = await Promise.all([
    actor.supabase.from("memberships").select("user_id,membership_role,membership_status,notes,joined_at,approved_at,created_at,updated_at").order("created_at", { ascending: false }).limit(1000),
    actor.supabase.from("profiles").select("id,display_name,bio").limit(1000),
  ]);
  if (results.some(result => result.error)) return moduleFailure("No se pudo cargar el registro de miembros. Vuelve a intentar.");
  const profiles = new Map((results[1].data ?? []).map(profile => [profile.id, profile]));
  return {
    ok: true, message: "Miembros cargados.", actorRole: actor.role,
    members: (results[0].data ?? []).map(row => ({
      userId: row.user_id, name: profiles.get(row.user_id)?.display_name || "Miembro sin nombre",
      bio: profiles.get(row.user_id)?.bio ?? null, role: row.membership_role as PlatformRole,
      status: row.membership_status as ManagedMember["status"], notes: row.notes,
      joinedAt: row.joined_at, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  };
}

export async function updateMemberAccessAction(input: { userId: string; status: ManagedMember["status"]; role: PlatformRole; notes?: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["club_manager", "admin"]);
  if (error || !actor) return error!;
  const roles: PlatformRole[] = ["member", "coordinator", "editor", "club_manager", "admin"];
  if (!validUuid(input?.userId) || !["pending", "active", "suspended"].includes(input?.status)
    || !roles.includes(input?.role) || (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.trim().length > 4000))) {
    return moduleFailure("Revisa el miembro, el acceso y las notas.", "invalid");
  }
  if (input.userId === actor.userId) return moduleFailure("Tu cuenta actual conserva su acceso. Otro administrador debe cambiarlo.", "forbidden");
  const { data: current, error: currentError } = await actor.supabase.from("memberships")
    .select("membership_role,membership_status,joined_at,approved_at,approved_by,updated_at,notes").eq("user_id", input.userId).maybeSingle();
  if (currentError || !current) return moduleFailure("El miembro ya no está disponible.");
  if (actor.role !== "admin" && (current.membership_role === "admin" || input.role === "admin" || input.role === "club_manager" && current.membership_role !== "club_manager")) {
    return moduleFailure("Solo un administrador puede asignar acceso de administración o cambiar una cuenta administradora.", "forbidden");
  }
  const firstActivation = input.status === "active" && !current.joined_at;
  const now = new Date().toISOString();
  const { data, error: updateError } = await actor.supabase.from("memberships").update({
    membership_role: input.role, membership_status: input.status, notes: input.notes === undefined ? current.notes : input.notes?.trim() || null,
    joined_at: firstActivation ? now : current.joined_at,
    approved_at: input.status === "active" && !current.approved_at ? now : current.approved_at,
    approved_by: input.status === "active" && !current.approved_by ? actor.userId : current.approved_by,
  }).eq("user_id", input.userId).eq("updated_at", current.updated_at).select("user_id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo guardar el acceso. Recarga la ficha e inténtalo de nuevo.");
  revalidatePath("/plataforma");
  return { ok: true, message: "El acceso y las notas del miembro quedaron guardados." };
}

export async function updateMemberProfileAction(input: { userId: string; name: string; bio?: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["club_manager", "admin"]);
  if (error || !actor) return error!;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const bio = typeof input?.bio === "string" ? input.bio.trim() : "";
  if (!validUuid(input?.userId) || name.length < 2 || name.length > 120 || bio.length > 4000) return moduleFailure("Escribe un nombre válido y una descripción de hasta 4,000 caracteres.", "invalid");
  const { data, error: updateError } = await actor.supabase.from("profiles").update({ display_name: name, bio: bio || null }).eq("id", input.userId).select("id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo actualizar la ficha del miembro.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La ficha del miembro quedó actualizada." };
}
