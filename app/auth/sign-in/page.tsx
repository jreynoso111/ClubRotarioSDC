import { redirect } from "next/navigation";

import { SignInForm } from "@/app/auth/SignInForm";
import { safeAuthNext } from "@/lib/auth-navigation";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeAuthNext(params.next);
  // Returning from the public site with a valid session goes straight back to the
  // platform; notices and errors always show the form because they end the session.
  if (!params.notice && !params.error && nextPath.startsWith("/plataforma") && isSupabaseConfigured()
    && await hasValidSession()) {
    redirect(nextPath);
  }
  const notice = params.notice === "password-updated" ? "Contraseña actualizada. Inicia sesión con tu nueva clave."
    : params.notice === "session-expired" ? "Tu sesión terminó. Vuelve a iniciar sesión para confirmar tu identidad."
    : params.notice === "confirmed" ? "Correo confirmado. Tu cuenta necesita la aprobación de la administración antes de acceder."
    : "";
  return <SignInForm nextPath={nextPath} confirmationError={params.error === "confirmation"} notice={notice} />;
}

async function hasValidSession() {
  try {
    const { data, error } = await (await createClient()).auth.getClaims();
    return !error && Boolean(data?.claims?.sub);
  } catch {
    return false;
  }
}
