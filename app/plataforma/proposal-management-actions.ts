"use server";

import { revalidatePath } from "next/cache";

import { moduleFailure, requireModuleActor, validUuid } from "./module-auth";
import type { PlatformActionResult } from "./actions";

export async function editProposalDraftAction(input: {
  proposalId: string;
  title: string;
  summary: string;
  details: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["member", "coordinator", "editor", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const summary = typeof input?.summary === "string" ? input.summary.trim() : "";
  const details = typeof input?.details === "string" ? input.details.trim() : "";
  if (!validUuid(input?.proposalId) || title.length < 3 || title.length > 180 || summary.length < 10 || summary.length > 1200 || details.length > 4000) {
    return moduleFailure("Revisa el título, el resumen y los detalles.", "invalid");
  }

  const existing = await actor.supabase.from("proposals")
    .select("id,status,updated_at,voting_open")
    .eq("id", input.proposalId)
    .eq("created_by", actor.userId)
    .maybeSingle();
  if (existing.error || !existing.data || !["draft", "rejected"].includes(existing.data.status)) {
    return moduleFailure("Solo puedes editar tus propuestas en borrador o corregir las rechazadas.", "forbidden");
  }
  const corrected = existing.data.status === "rejected";
  const { data, error: writeError } = await actor.supabase.from("proposals")
    .update({
      title, summary, details, status: "draft",
      ...(corrected ? { submitted_at: null, reviewed_at: null, reviewed_by: null } : {}),
    })
    .eq("id", input.proposalId)
    .eq("created_by", actor.userId)
    .eq("status", existing.data.status)
    .eq("updated_at", existing.data.updated_at)
    .eq("voting_open", false)
    .select("id")
    .maybeSingle();
  if (writeError || !data) return moduleFailure("La propuesta cambió. Actualiza la página antes de guardar tus correcciones.");
  revalidatePath("/plataforma");
  return { ok: true, message: corrected ? "La corrección quedó como borrador. Ya puedes enviarla de nuevo a revisión." : "El borrador quedó actualizado." };
}

export async function reviewProposalAction(input: {
  proposalId: string;
  status: "in_review" | "approved" | "rejected" | "archived";
  notes: string;
}): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["coordinator", "club_manager", "admin"]);
  if (error || !actor) return error!;
  const notes = typeof input?.notes === "string" ? input.notes.trim() : "";
  if (!validUuid(input?.proposalId) || !["in_review", "approved", "rejected", "archived"].includes(input?.status) || notes.length > 4000 || (input.status === "rejected" && notes.length < 10)) {
    return moduleFailure("Elige una decisión válida y explica el motivo del rechazo.", "invalid");
  }
  const existing = await actor.supabase.from("proposals")
    .select("id,status,voting_open,updated_at")
    .eq("id", input.proposalId)
    .maybeSingle();
  if (existing.error || !existing.data || existing.data.status === "draft" || existing.data.status === "archived") {
    return moduleFailure("La propuesta debe enviarse a revisión antes de tomar una decisión.", "invalid");
  }
  if (existing.data.voting_open) return moduleFailure("Cierra primero la votación para registrar la decisión.", "invalid");
  const { data, error: writeError } = await actor.supabase.from("proposals")
    .update({ status: input.status, review_notes: notes || null, reviewed_by: actor.userId, reviewed_at: new Date().toISOString() })
    .eq("id", input.proposalId)
    .eq("status", existing.data.status)
    .eq("updated_at", existing.data.updated_at)
    .eq("voting_open", false)
    .select("id")
    .maybeSingle();
  if (writeError || !data) return moduleFailure("La propuesta cambió. Actualiza la página e inténtalo nuevamente.");
  revalidatePath("/plataforma");
  return { ok: true, message: "La decisión quedó registrada en la propuesta." };
}
