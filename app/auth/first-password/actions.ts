"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { endServerSession } from "@/utils/supabase/end-session";
import { isTemporaryPassword } from "@/lib/initial-password";

export async function completeInitialPasswordAction(password: string, confirmation: string) {
  if (typeof password !== "string" || password.length < 8 || password.length > 64 || Buffer.byteLength(password, "utf8") > 72 || password !== confirmation) {
    return { ok: false, message: "Escribe una contraseña de 8 a 64 caracteres y repítela igual." };
  }
  try {
    const client = await createClient();
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return { ok: false, message: "Tu sesión terminó. Vuelve a iniciar sesión." };
    const identity = user.data.user;
    const state = await client.rpc("account_password_state");
    if (state.error || state.data !== "required") return { ok: false, message: "Este cambio inicial ya no está pendiente. Vuelve a iniciar sesión." };
    const admin = createAdminClient();
    const setup = await admin.from("account_password_setups").select("password_salt,initial_password_digest,completed_at")
      .eq("user_id", identity.id).single();
    if (setup.error || setup.data?.completed_at || !setup.data?.password_salt || !setup.data?.initial_password_digest) {
      return { ok: false, message: "No se pudo consultar el cambio inicial. Contacta a la administración." };
    }
    if (await isTemporaryPassword(password, setup.data.password_salt, setup.data.initial_password_digest)) {
      return { ok: false, message: "Elige una contraseña distinta de la temporal que te entregó el administrador." };
    }
    const changed = await client.auth.updateUser({ password });
    if (changed.error) return { ok: false, message: "No se pudo cambiar la contraseña. Elige una clave segura y diferente de la actual." };
    const metadata = await admin.auth.admin.updateUserById(identity.id, {
      app_metadata: { ...identity.app_metadata, require_password_change: false },
    });
    if (metadata.error) return { ok: false, message: "La contraseña cambió, pero falta completar la activación. Inténtalo con otra contraseña nueva." };
    const completed = await admin.from("account_password_setups").update({ completed_at: new Date().toISOString(),
      password_salt: null, initial_password_digest: null }).eq("user_id", identity.id).is("completed_at", null).select("user_id").single();
    if (completed.error || !completed.data) return { ok: false, message: "Falta completar la activación. Inténtalo con otra contraseña nueva." };
    await endServerSession(true);
    return { ok: true, message: "Contraseña establecida. Inicia sesión con tu nueva clave." };
  } catch { return { ok: false, message: "No se pudo completar el cambio. Inténtalo de nuevo." }; }
}
