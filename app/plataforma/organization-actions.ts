"use server";

import { revalidatePath } from "next/cache";
import { currentRotaryYear, organizationAccessLevels, type OrganizationData, type OrganizationMember, type LeadershipPosition } from "@/lib/organization";
import type { PlatformRole } from "@/lib/platform";
import type { PlatformActionResult } from "./actions";
import { moduleFailure, requireModuleActor, validUuid } from "./module-auth";

function organizationError(error: { code?: string; message?: string } | null) {
  if (error?.code === "23505") return moduleFailure("Ya existe un cargo con ese nombre en este período.", "invalid");
  if (error?.code === "40001") return moduleFailure("Este cargo cambió mientras lo editabas. Actualiza el organigrama antes de guardar.");
  if (error?.code === "22023") {
    const message = error.message ?? "";
    if (message.includes("cycle")) return moduleFailure("Un cargo no puede depender de sí mismo ni de uno de sus cargos subordinados.", "invalid");
    if (message.includes("closed")) return moduleFailure("Este período tiene la edición cerrada. Reábrelo antes de cambiar el organigrama.", "invalid");
    if (message.includes("active members")) return moduleFailure("Elige un miembro con membresía activa para asignar el cargo.", "invalid");
    if (message.includes("subordinate")) return moduleFailure("Reubica los cargos que dependen de este antes de retirarlo del organigrama.", "invalid");
    if (message.includes("current Rotary year")) return moduleFailure("Los accesos solo se aplican desde cargos activos del año rotario actual.", "invalid");
    return moduleFailure("Revisa el período y la relación entre los cargos.", "invalid");
  }
  if (error?.code === "42501") return moduleFailure(error.message?.includes("own access") ? "Tu cuenta conserva su acceso de administrador. Otro administrador tendría que cambiarlo." : "Solo un administrador activo puede cambiar el organigrama.", "forbidden");
  return moduleFailure("No se pudo guardar el organigrama. Conservamos los datos para que puedas volver a intentarlo.");
}

export async function getOrganizationAction(termId?: string): Promise<PlatformActionResult & { organization?: OrganizationData }> {
  const { actor, error } = await requireModuleActor(["member", "coordinator", "editor", "club_manager", "admin"]);
  if (error || !actor) return error!;
  if (termId !== undefined && !validUuid(termId)) return moduleFailure("El período indicado no es válido.", "invalid");
  try {
    const { data: termRows, error: termError } = await actor.supabase.from("club_leadership_terms")
      .select("id,start_year,label,is_locked,updated_at").order("start_year", { ascending: false }).limit(231);
    if (termError) return moduleFailure("No se pudo cargar el organigrama del club. Vuelve a intentar.");
    const terms = (termRows ?? []).map(row => ({ id: row.id, startYear: row.start_year, label: row.label, locked: row.is_locked, updatedAt: row.updated_at }));
    const selected = termId ? terms.find(term => term.id === termId) : terms.find(term => term.startYear === currentRotaryYear()) ?? terms[0];
    if (termId && !selected) return moduleFailure("Ese período ya no está disponible.", "invalid");
    const members: OrganizationMember[] = [];
    for (let page = 0; ; page++) {
      const { data, error: profilesError } = await actor.supabase.from("profiles").select("id,display_name,bio").order("id").range(page * 200, page * 200 + 199);
      if (profilesError) return moduleFailure("No se pudieron cargar los perfiles del club.");
      members.push(...(data ?? []).map(row => ({ userId: row.id, name: row.display_name || "Miembro sin nombre", bio: row.bio ?? null })));
      if (!data || data.length < 200) break;
    }
    if (actor.role === "admin") {
      const activeIds = new Map<string, PlatformRole>();
      for (let page = 0; ; page++) {
        const { data, error: membersError } = await actor.supabase.from("memberships").select("user_id,membership_role").eq("membership_status", "active").order("user_id").range(page * 200, page * 200 + 199);
        if (membersError) return moduleFailure("No se pudo comprobar la lista de miembros activos.");
        (data ?? []).forEach(row => activeIds.set(row.user_id, row.membership_role as PlatformRole));
        if (!data || data.length < 200) break;
      }
      members.splice(0, members.length, ...members.filter(member => activeIds.has(member.userId)).map(member => ({ ...member, accessRole: activeIds.get(member.userId) })));
    }
    let positions: LeadershipPosition[] = [];
    if (selected) {
      const { data, error: positionError } = await actor.supabase.from("club_leadership_positions")
        .select("id,term_id,title,responsibilities,parent_id,member_id,member_name_snapshot,sort_order,is_active,access_role,updated_at")
        .eq("term_id", selected.id).order("sort_order").order("id").limit(60);
      if (positionError) return moduleFailure("No se pudieron cargar los cargos de este período.");
      const names = new Map(members.map(member => [member.userId, member.name]));
      positions = (data ?? []).map(row => ({ id: row.id, termId: row.term_id, title: row.title, responsibilities: row.responsibilities, parentId: row.parent_id,
        memberId: row.member_id, memberName: names.get(row.member_id) ?? row.member_name_snapshot, sortOrder: row.sort_order, active: row.is_active, accessRole: row.access_role as PlatformRole, updatedAt: row.updated_at }));
    }
    return { ok: true, message: "Organigrama cargado.", organization: { terms, positions, members, termId: selected?.id ?? null } };
  } catch { return moduleFailure("No se pudo conectar con el organigrama. Vuelve a intentar."); }
}

export async function createLeadershipTermAction(input: { startYear: number; label?: string; templateTermId?: string | null }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["admin"]);
  if (error || !actor) return error!;
  if (!Number.isInteger(input?.startYear) || input.startYear < 1970 || input.startYear > 2200
    || input.label !== undefined && (typeof input.label !== "string" || input.label.trim().length > 120)
    || input.templateTermId != null && !validUuid(input.templateTermId)) return moduleFailure("Revisa el año y el nombre del período.", "invalid");
  const { data, error: createError } = await actor.supabase.rpc("create_club_leadership_term", { _start_year: input.startYear, _label: input.label?.trim() ?? "", _template_term_id: input.templateTermId ?? null });
  if (createError || typeof data !== "string") return organizationError(createError);
  revalidatePath("/plataforma");
  return { ok: true, message: "El período está listo. Asigna los miembros a sus cargos.", id: data };
}

export async function saveLeadershipPositionAction(input: {
  id?: string | null; termId: string; title: string; responsibilities: string; parentId: string | null;
  memberId: string | null; sortOrder: number; active: boolean; accessRole: PlatformRole; applyAccess: boolean; updatedAt?: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const responsibilities = typeof input?.responsibilities === "string" ? input.responsibilities.trim() : "";
  if (!validUuid(input?.termId) || input.id != null && !validUuid(input.id) || title.length < 2 || title.length > 100
    || typeof input.responsibilities !== "string" || responsibilities.length > 1200 || input.parentId != null && !validUuid(input.parentId)
    || input.memberId != null && !validUuid(input.memberId) || !Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 999
    || typeof input.active !== "boolean" || !organizationAccessLevels.some(level => level.id === input.accessRole) || typeof input.applyAccess !== "boolean"
    || input.id && (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt)))) {
    return moduleFailure("Revisa el nombre, el miembro y la ubicación del cargo.", "invalid");
  }
  if (input.id && input.parentId === input.id) return moduleFailure("Un cargo no puede depender de sí mismo.", "invalid");
  if (input.applyAccess && (!input.memberId || !input.active)) return moduleFailure("Selecciona un miembro y un cargo activo para aplicar el acceso.", "invalid");
  const result = await actor.supabase.rpc("save_club_leadership_position", { _position_id: input.id ?? null, _term_id: input.termId, _title: title,
    _responsibilities: responsibilities, _parent_id: input.parentId, _member_id: input.memberId, _sort_order: input.sortOrder,
    _is_active: input.active, _access_role: input.accessRole, _apply_access: input.applyAccess, _expected_updated_at: input.updatedAt ?? null });
  if (result.error) return organizationError(result.error);
  if (typeof result.data !== "string") return moduleFailure("Este cargo cambió mientras lo editabas. Actualiza el organigrama y vuelve a intentarlo.");
  revalidatePath("/plataforma");
  return { ok: true, message: input.applyAccess ? "El cargo, su asignación y el acceso del miembro quedaron guardados." : "El cargo y su asignación quedaron guardados. El acceso del miembro se conserva.", id: result.data };
}

export async function setLeadershipTermLockAction(input: { termId: string; locked: boolean; updatedAt: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["admin"]);
  if (error || !actor) return error!;
  if (!validUuid(input?.termId) || typeof input.locked !== "boolean" || typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt))) return moduleFailure("El período indicado no es válido.", "invalid");
  const { data, error: updateError } = await actor.supabase.from("club_leadership_terms").update({ is_locked: input.locked }).eq("id", input.termId).eq("updated_at", input.updatedAt).select("id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo cambiar la edición del período. Actualiza el organigrama.");
  revalidatePath("/plataforma");
  return { ok: true, message: input.locked ? "La directiva quedó conservada con la edición cerrada." : "La edición del período está abierta." };
}
