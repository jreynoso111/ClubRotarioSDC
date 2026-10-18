"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { memberCredentialsEmail, sendClubEmail } from "@/lib/email";
import { temporaryPasswordDigest } from "@/lib/initial-password";
import { getPublicSiteOrigin } from "@/utils/site-url";
import { TEMPORARY_PASSWORD_MIN_LENGTH } from "@/lib/temporary-password";
import { moduleFailure, requireModuleActor } from "./module-auth";
import type { PlatformActionResult } from "./actions";

export async function createMemberAccountAction(input: { name: string; email: string; temporaryPassword: string }): Promise<PlatformActionResult> {
  const { actor, error } = await requireModuleActor(["admin"]);
  if (!actor) return error!;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = input?.temporaryPassword;
  if (name.length < 2 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== "string" || password.length < TEMPORARY_PASSWORD_MIN_LENGTH || password.length > 64 || Buffer.byteLength(password, "utf8") > 72) {
    return moduleFailure("Indica el nombre, un correo válido y una contraseña temporal de 8 a 64 caracteres.", "invalid");
  }
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return moduleFailure("La creación de cuentas no está disponible ahora."); }
  let createdId: string | undefined;
  try {
    const initial = await temporaryPasswordDigest(password);
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { display_name: name },
      app_metadata: { require_password_change: true, admin_created_by: actor.userId } });
    if (created.error || !created.data.user) {
      return moduleFailure(created.error?.code === "email_exists" || created.error?.code === "user_already_exists"
        ? "Ya existe una cuenta con ese correo. Consulta su ficha en Miembros." : "No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.");
    }
    createdId = created.data.user.id;
    const setup = await admin.from("account_password_setups").insert({ user_id: createdId, created_by: actor.userId,
      password_salt: initial.salt, initial_password_digest: initial.digest });
    if (setup.error) throw new Error("setup_failed");
    const membership = await actor.supabase.from("memberships").select("updated_at").eq("user_id", createdId).single();
    if (membership.error || !membership.data) throw new Error("membership_unavailable");
    const activation = await actor.supabase.rpc("update_member_access", { _user_id: createdId, _role: "member", _status: "active",
      _notes: null, _reason: "Cuenta de miembro creada por administración.", _expected_updated_at: membership.data.updated_at });
    if (activation.error) throw new Error("activation_failed");
    revalidatePath("/plataforma");
    const sent = await sendClubEmail({ to: email, ...memberCredentialsEmail(name, email, password, `${getPublicSiteOrigin()}/auth/sign-in`) });
    return { ok: true, message: sent
      ? `Miembro creado. Le enviamos sus datos de acceso a ${email}; deberá cambiar la contraseña temporal al entrar por primera vez.`
      : "Miembro creado, pero no se pudo enviar el correo con sus datos de acceso. Entrégale el correo y la contraseña temporal directamente; deberá cambiarla al entrar." };
  } catch {
    // Only the identity created by this request is eligible for compensation.
    if (createdId) {
      const removed = await admin.auth.admin.deleteUser(createdId).catch(() => ({ error: true }));
      if (removed.error) return moduleFailure("El alta quedó incompleta y bloqueada. Revisa la cuenta en Miembros antes de volver a intentarlo.");
    }
    return moduleFailure("No se pudo completar el alta. Vuelve a intentarlo.");
  }
}
