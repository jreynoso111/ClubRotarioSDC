"use server";

import { redirect } from "next/navigation";

import {
  avatarBucket,
  avatarMaxBytes,
  avatarObjectName,
  isOwnAvatarPath,
  validateBio,
  validateDisplayName,
  validateEmailAddress,
  validateNewPassword,
  validateReauthCode,
} from "@/lib/account";
import { endServerSession } from "@/utils/supabase/end-session";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";
import { getPublicSiteOrigin } from "@/utils/site-url";

type AccountActionCode =
  | "unauthenticated"
  | "password_setup_required"
  | "forbidden"
  | "invalid"
  | "reauthentication_required"
  | "rate_limited"
  | "backend_error";

export type AccountActionResult = {
  ok: boolean;
  message: string;
  code?: AccountActionCode;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;
type AccountActor = { supabase: Supabase; userId: string; email: string };

function failure(message: string, code: AccountActionCode = "backend_error"): AccountActionResult {
  return { ok: false, message, code };
}

function success(message: string): AccountActionResult {
  return { ok: true, message };
}

function authErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// Same membership rule as the rest of the platform: a signed-in account with an active membership.
async function requireAccountActor(): Promise<{ actor: AccountActor } | { error: AccountActionResult }> {
  if (!isSupabaseConfigured()) return { error: failure("La conexión del club todavía no está configurada.") };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { error: failure("Tu sesión terminó. Vuelve a iniciar sesión.", "unauthenticated") };
    if (data.user.app_metadata?.require_password_change === true) {
      return { error: failure("Primero debes establecer tu contraseña inicial.", "password_setup_required") };
    }
    const { data: membership, error: membershipError } = await supabase.from("memberships")
      .select("membership_status").eq("user_id", data.user.id).maybeSingle();
    if (membershipError) return { error: failure("No se pudo verificar tu membresía. Inténtalo de nuevo.") };
    if (membership?.membership_status !== "active") return { error: failure("Esta acción requiere una membresía activa.", "forbidden") };
    return { actor: { supabase, userId: data.user.id, email: data.user.email ?? "" } };
  } catch {
    return { error: failure("No se pudo conectar con el club. Inténtalo de nuevo.") };
  }
}

// Only the caller's own folder can be touched. The browser-side Storage policy
// (club_media_own_delete) enforces the same rule, so the caller's client is used.
async function removeOwnAvatarObject(supabase: Supabase, userId: string, previous: string | null | undefined, keep: string | null) {
  if (!previous || previous === keep || !isOwnAvatarPath(userId, previous)) return;
  try {
    await supabase.storage.from(avatarBucket).remove([previous]);
  } catch {
    // The profile already points at the new state; a leftover object is harmless.
  }
}

export async function updateOwnProfileAction(input: { displayName: unknown; bio: unknown }): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const name = validateDisplayName(input?.displayName);
  if (!name.ok) return failure(name.message, "invalid");
  const bio = validateBio(input?.bio);
  if (!bio.ok) return failure(bio.message, "invalid");
  const { supabase, userId } = guard.actor;
  const { data, error } = await supabase.from("profiles")
    .update({ display_name: name.value, bio: bio.value || null })
    .eq("id", userId).select("id").maybeSingle();
  if (error || !data) return failure("No se pudo guardar tu perfil. Inténtalo de nuevo.");
  return success("Tu perfil se guardó.");
}

export async function saveAvatarAction(path: unknown): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const { supabase, userId } = guard.actor;
  if (!isOwnAvatarPath(userId, path)) return failure("La foto no es válida. Vuelve a subirla.", "invalid");

  // The object must exist in the caller's folder and stay within the size limit.
  const objectName = avatarObjectName(userId, path);
  const { data: listed, error: listError } = await supabase.storage.from(avatarBucket).list(userId, { search: objectName, limit: 20 });
  const uploaded = listed?.find(item => item.name === objectName);
  if (listError || !uploaded || Number(uploaded.metadata?.size ?? 0) > avatarMaxBytes) {
    return failure("No encontramos la foto subida. Vuelve a intentarlo.", "invalid");
  }

  const { data: current, error: currentError } = await supabase.from("profiles")
    .select("avatar_path").eq("id", userId).maybeSingle();
  if (currentError) return failure("No se pudo guardar la foto. Inténtalo de nuevo.");
  const { data: updated, error: updateError } = await supabase.from("profiles")
    .update({ avatar_path: path }).eq("id", userId).select("id").maybeSingle();
  if (updateError || !updated) return failure("No se pudo guardar la foto. Inténtalo de nuevo.");

  await removeOwnAvatarObject(supabase, userId, current?.avatar_path, path);
  return success("Tu foto de perfil se actualizó.");
}

export async function removeAvatarAction(): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const { supabase, userId } = guard.actor;
  const { data: current, error: currentError } = await supabase.from("profiles")
    .select("avatar_path").eq("id", userId).maybeSingle();
  if (currentError) return failure("No se pudo quitar la foto. Inténtalo de nuevo.");
  if (!current?.avatar_path) return success("Tu perfil no tiene una foto para quitar.");
  const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", userId).select("id").maybeSingle();
  if (error) return failure("No se pudo quitar la foto. Inténtalo de nuevo.");
  await removeOwnAvatarObject(supabase, userId, current.avatar_path, null);
  return success("Quitamos tu foto de perfil. Se mostrarán tus iniciales.");
}

export async function changeEmailAction(email: unknown): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const next = validateEmailAddress(email, guard.actor.email);
  if (!next.ok) return failure(next.message, "invalid");
  const { error } = await guard.actor.supabase.auth.updateUser(
    { email: next.value },
    { emailRedirectTo: `${getPublicSiteOrigin()}/auth/complete` },
  );
  if (error) {
    const code = authErrorCode(error);
    if (code === "email_exists" || code === "user_already_exists") return failure("Ese correo ya está en uso en otra cuenta.", "invalid");
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
      return failure("Espera un momento antes de pedir otro cambio de correo.", "rate_limited");
    }
    if (code === "email_address_invalid") return failure("Escribe un correo electrónico válido.", "invalid");
    return failure("No se pudo iniciar el cambio de correo. Inténtalo de nuevo.");
  }
  return success("Te enviamos un enlace de confirmación. El cambio se aplica cuando lo abras.");
}

export async function requestPasswordCodeAction(): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const { error } = await guard.actor.supabase.auth.reauthenticate();
  if (error) {
    const code = authErrorCode(error);
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
      return failure("Espera un minuto antes de pedir otro código.", "rate_limited");
    }
    return failure("No pudimos enviar el código. Inténtalo de nuevo.");
  }
  return success("Te enviamos un código de 6 dígitos a tu correo. Escríbelo abajo para continuar.");
}

export async function changePasswordAction(input: { code: unknown; password: unknown; confirm: unknown }): Promise<AccountActionResult> {
  const guard = await requireAccountActor();
  if ("error" in guard) return guard.error;
  const code = validateReauthCode(input?.code);
  if (!code.ok) return failure(code.message, "invalid");
  const password = validateNewPassword(input?.password, input?.confirm);
  if (!password.ok) return failure(password.message, "invalid");

  // The password itself is never logged or echoed back to the browser.
  const { error } = await guard.actor.supabase.auth.updateUser({ password: password.value, nonce: code.value });
  if (error) {
    switch (authErrorCode(error)) {
      case "reauthentication_needed":
      case "reauth_nonce_missing":
        return failure("Solicita un código nuevo y vuelve a intentarlo.", "reauthentication_required");
      case "reauthentication_not_valid":
      case "otp_expired":
        return failure("El código no es válido o ya venció. Solicita uno nuevo.", "reauthentication_required");
      case "weak_password":
        return failure("Elige una contraseña más segura.", "invalid");
      case "same_password":
        return failure("Elige una contraseña distinta de la actual.", "invalid");
      case "over_request_rate_limit":
        return failure("Espera un momento antes de intentarlo de nuevo.", "rate_limited");
      default:
        return failure("No se pudo cambiar la contraseña. Inténtalo de nuevo.");
    }
  }
  return success("Tu contraseña se cambió. Otros dispositivos pueden seguir con sesión abierta; si quieres cerrarlos, usa «Cerrar sesión en todos los dispositivos».");
}

export async function signOutEverywhereAction(): Promise<never> {
  await endServerSession(true);
  redirect("/auth/sign-in");
}
