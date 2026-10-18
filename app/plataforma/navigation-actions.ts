"use server";

import { revalidatePath } from "next/cache";
import { isNavigationOrder, type PlatformNavigation } from "@/lib/platform-navigation";
import type { PlatformActionResult } from "./actions";
import { moduleFailure, requireModuleActor } from "./module-auth";

type NavigationResult = PlatformActionResult & { navigation?: PlatformNavigation };

export async function getNavigationOrderAction(): Promise<NavigationResult> {
  const { actor, error } = await requireModuleActor(["member", "coordinator", "editor", "club_manager", "admin"]);
  if (!actor) return error!;
  const result = await actor.supabase.from("platform_navigation").select("item_order,revision").eq("id", true).maybeSingle();
  if (result.error || !result.data || !isNavigationOrder(result.data.item_order)) {
    return moduleFailure("No se pudo consultar el orden del menú.");
  }
  return { ok: true, message: "", navigation: { order: result.data.item_order, revision: result.data.revision, available: true } };
}

export async function saveNavigationOrderAction(order: unknown, revision: number): Promise<NavigationResult> {
  const { actor, error } = await requireModuleActor(["admin"]);
  if (!actor) return error!;
  if (!isNavigationOrder(order) || !Number.isSafeInteger(revision) || revision < 0) {
    return moduleFailure("El orden del menú no es válido.", "invalid");
  }
  const result = await actor.supabase.from("platform_navigation").update({ item_order: order })
    .eq("id", true).eq("revision", revision).select("item_order,revision").maybeSingle();
  if (result.error) return moduleFailure("No se pudo guardar el orden del menú. Inténtalo de nuevo.");
  if (!result.data) {
    return { ...moduleFailure("Otro administrador cambió el menú. Se ha cargado el orden actual; vuelve a intentarlo.", "conflict"),
      navigation: (await getNavigationOrderAction()).navigation };
  }
  revalidatePath("/plataforma");
  return { ok: true, message: "Orden guardado para todo el club.",
    navigation: { order: result.data.item_order, revision: result.data.revision, available: true } };
}
