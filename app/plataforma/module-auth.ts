import "server-only";

import type { PlatformRole } from "@/lib/platform";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";
import type { PlatformActionResult } from "./actions";

export function moduleFailure(message: string, code: PlatformActionResult["code"] = "backend_error"): PlatformActionResult {
  return { ok: false, message, code };
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function requireModuleActor(roles: PlatformRole[]) {
  if (!isSupabaseConfigured()) return { error: moduleFailure("La conexión del club todavía no está configurada.") };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { error: moduleFailure("Tu sesión terminó. Vuelve a iniciar sesión.", "unauthenticated") };
    const { data: membership, error: membershipError } = await supabase.from("memberships")
      .select("membership_role,membership_status").eq("user_id", data.user.id).maybeSingle();
    if (membershipError) return { error: moduleFailure("No se pudo verificar tu membresía.") };
    if (membership?.membership_status !== "active") return { error: moduleFailure("Esta acción requiere una membresía activa.", "forbidden") };
    if (!roles.includes(membership.membership_role as PlatformRole)) return { error: moduleFailure("Tu rol no permite realizar esta acción.", "forbidden") };
    return { actor: { supabase, userId: data.user.id, role: membership.membership_role as PlatformRole } };
  } catch {
    return { error: moduleFailure("No se pudo conectar con el club. Inténtalo de nuevo.") };
  }
}

export async function isAssignableMember(actor: NonNullable<Awaited<ReturnType<typeof requireModuleActor>>["actor"]>, userId: string) {
  if (!validUuid(userId)) return false;
  // The directory SELECT policy exposes other profiles only for active memberships.
  // Management can see suspended profiles, so it must also check their membership.
  if (actor.role === "admin" || actor.role === "club_manager") {
    const { data, error } = await actor.supabase.from("memberships").select("user_id")
      .eq("user_id", userId).eq("membership_status", "active").maybeSingle();
    return !error && Boolean(data);
  }
  const { data, error } = await actor.supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  return !error && Boolean(data);
}
