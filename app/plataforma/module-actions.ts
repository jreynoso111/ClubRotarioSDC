"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import type { PlatformActivity, PlatformDirectoryMember, PlatformTask } from "@/lib/platform";
import type { PlatformActionResult } from "./actions";
import { isAssignableMember, moduleFailure, requireModuleActor, validUuid } from "./module-auth";

type ActivityInput = { activityId: string; title: string; description?: string; status: "planned" | "active" | "completed" | "cancelled"; startsAt?: string; endsAt?: string; location?: string; leadId?: string };
type TaskInput = { activityId: string; title: string; description?: string; priority: "low" | "normal" | "high" | "urgent"; dueAt?: string; assigneeId?: string };
export type ActivityWorkspace = { activities: PlatformActivity[]; tasks: PlatformTask[]; members: PlatformDirectoryMember[] };

async function readEveryPage<T>(query: (first: number, last: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const result = await query(offset, offset + pageSize - 1);
    if (result.error) throw new Error("The workspace query failed.");
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function getActivityWorkspaceAction(): Promise<PlatformActionResult & { workspace?: ActivityWorkspace }> {
  const { actor, error } = await requireModuleActor(["member", "coordinator", "editor", "club_manager", "admin"]);
  if (error || !actor) return error!;
  try {
    const isManagement = actor.role === "club_manager" || actor.role === "admin";
    const [activities, tasks, profiles, memberships] = await Promise.all([
      readEveryPage((first, last) => actor.supabase.from("activities")
        .select("id,title,description,activity_status,starts_at,ends_at,location,lead_id")
        .order("created_at", { ascending: false }).order("id").range(first, last)),
      readEveryPage((first, last) => actor.supabase.from("tasks")
        .select("id,title,description,task_status,priority,due_at,activity_id,proposal_id,assignee_id")
        .order("created_at", { ascending: false }).order("id").range(first, last)),
      readEveryPage((first, last) => actor.supabase.from("profiles").select("id,display_name")
        .order("id").range(first, last)),
      isManagement ? readEveryPage((first, last) => actor.supabase.from("memberships").select("user_id")
        .eq("membership_status", "active").order("user_id").range(first, last)) : Promise.resolve(null),
    ]);
    const activeIds = memberships ? new Set(memberships.map(member => member.user_id)) : null;
    return { ok: true, message: "Actividades y tareas cargadas.", workspace: {
      activities: activities.map(activity => ({ id: activity.id, title: activity.title, description: activity.description,
        status: activity.activity_status, startsAt: activity.starts_at, endsAt: activity.ends_at, location: activity.location, leadId: activity.lead_id })),
      tasks: tasks.map(task => ({ id: task.id, title: task.title, description: task.description, status: task.task_status,
        priority: task.priority, dueAt: task.due_at, activityId: task.activity_id, proposalId: task.proposal_id, assigneeId: task.assignee_id })),
      members: profiles.filter(profile => !activeIds || activeIds.has(profile.id)).map(profile => ({ userId: profile.id, name: profile.display_name?.trim() || "Miembro del club" })).sort((left, right) => left.name.localeCompare(right.name, "es")),
    } };
  } catch { return moduleFailure("No se pudo cargar la lista completa de actividades y tareas. Puedes seguir trabajando con los registros visibles o volver a cargar."); }
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function createManagedActivityAction(input: { title: string; description?: string; startsAt?: string; endsAt?: string; location?: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["coordinator", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() || null : null;
  const location = typeof input?.location === "string" ? input.location.trim() || null : null;
  const startsAt = dateValue(input?.startsAt);
  const endsAt = dateValue(input?.endsAt);
  if (title.length < 3 || title.length > 180 || (description?.length ?? 0) > 4000 || (location?.length ?? 0) > 300
    || (input.startsAt && !startsAt) || (input.endsAt && !endsAt)
    || (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))) return moduleFailure("Revisa el nombre y las fechas de la actividad.", "invalid");
  const baseSlug = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!baseSlug) return moduleFailure("Escribe un nombre que permita identificar la actividad.", "invalid");
  const { data, error: insertError } = await actor.supabase.from("activities").insert({
    title, description, location, starts_at: startsAt, ends_at: endsAt, activity_status: "planned",
    slug: `${baseSlug}-${randomUUID()}`, created_by: actor.userId,
  }).select("id").maybeSingle();
  if (insertError || !data) return moduleFailure("No se pudo crear la actividad. El formulario conserva tus datos.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La actividad quedó preparada.", id: data.id };
}

export async function updateActivityAction(input: ActivityInput): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["coordinator", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() || null : null;
  const location = typeof input?.location === "string" ? input.location.trim() || null : null;
  const startsAt = dateValue(input?.startsAt);
  const endsAt = dateValue(input?.endsAt);
  if (!validUuid(input?.activityId) || title.length < 3 || title.length > 180 || (description?.length ?? 0) > 4000
    || (location?.length ?? 0) > 300 || !["planned", "active", "completed", "cancelled"].includes(input.status)
    || (input.startsAt && !startsAt) || (input.endsAt && !endsAt)
    || (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))) return moduleFailure("Revisa el nombre, el estado y las fechas de la actividad.", "invalid");
  const { data: current, error: currentError } = await actor.supabase.from("activities").select("id,lead_id").eq("id", input.activityId).maybeSingle();
  if (currentError || !current) return moduleFailure("La actividad ya no está disponible.", "invalid");
  if (input.leadId && input.leadId !== current.lead_id && !await isAssignableMember(actor, input.leadId)) return moduleFailure("El responsable debe tener una membresía activa.", "invalid");
  const { data, error: updateError } = await actor.supabase.from("activities").update({
    title, description, location, activity_status: input.status, starts_at: startsAt, ends_at: endsAt,
    lead_id: input.leadId || null, updated_by: actor.userId,
  }).eq("id", input.activityId).select("id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo actualizar la actividad. Inténtalo de nuevo.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La actividad quedó actualizada." };
}

export async function createTaskAction(input: TaskInput): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["coordinator", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() || null : null;
  const dueAt = dateValue(input?.dueAt);
  if (!validUuid(input?.activityId) || title.length < 2 || title.length > 180 || (description?.length ?? 0) > 4000
    || !["low", "normal", "high", "urgent"].includes(input.priority) || (input.dueAt && !dueAt)) return moduleFailure("Revisa la actividad, el nombre y la fecha de la tarea.", "invalid");
  const { data: activity, error: activityError } = await actor.supabase.from("activities").select("id,activity_status").eq("id", input.activityId).maybeSingle();
  if (activityError || !activity) return moduleFailure("Selecciona una actividad disponible.", "invalid");
  if (["completed", "cancelled"].includes(activity.activity_status)) return moduleFailure("Reabre la actividad antes de añadir tareas.", "invalid");
  if (input.assigneeId && !await isAssignableMember(actor, input.assigneeId)) return moduleFailure("La tarea debe asignarse a una membresía activa.", "invalid");
  const { data, error: insertError } = await actor.supabase.from("tasks").insert({
    activity_id: input.activityId, title, description, priority: input.priority,
    due_at: dueAt, assignee_id: input.assigneeId || null, created_by: actor.userId,
  }).select("id").maybeSingle();
  if (insertError || !data) return moduleFailure("No se pudo crear la tarea. Revisa los datos e inténtalo de nuevo.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La tarea quedó vinculada a la actividad.", id: data.id };
}

export async function updateTaskAction(input: TaskInput & { taskId: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["coordinator", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() || null : null;
  const dueAt = dateValue(input?.dueAt);
  if (!validUuid(input?.taskId) || !validUuid(input?.activityId) || title.length < 2 || title.length > 180
    || (description?.length ?? 0) > 4000 || !["low", "normal", "high", "urgent"].includes(input.priority)
    || (input.dueAt && !dueAt)) return moduleFailure("Revisa los datos de la tarea.", "invalid");
  const { data: current, error: currentError } = await actor.supabase.from("tasks").select("id,assignee_id")
    .eq("id", input.taskId).eq("activity_id", input.activityId).maybeSingle();
  if (currentError || !current) return moduleFailure("La tarea ya no está disponible en esta actividad.", "invalid");
  if (input.assigneeId && input.assigneeId !== current.assignee_id && !await isAssignableMember(actor, input.assigneeId)) return moduleFailure("La tarea debe asignarse a una membresía activa.", "invalid");
  const { data, error: updateError } = await actor.supabase.from("tasks").update({
    title, description, priority: input.priority, due_at: dueAt, assignee_id: input.assigneeId || null, updated_by: actor.userId,
  }).eq("id", input.taskId).eq("activity_id", input.activityId).select("id").maybeSingle();
  if (updateError || !data) return moduleFailure("No se pudo actualizar la tarea de esta actividad.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La tarea quedó actualizada." };
}
