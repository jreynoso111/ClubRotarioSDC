import { SignInForm } from "@/app/auth/SignInForm";
import { safeAuthNext } from "@/lib/auth-navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const notice = params.notice === "password-updated" ? "Contraseña actualizada. Inicia sesión con tu nueva clave."
    : params.notice === "session-expired" ? "Tu sesión terminó. Vuelve a iniciar sesión para confirmar tu identidad."
    : params.notice === "confirmed" ? "Correo confirmado. Tu cuenta necesita la aprobación de la administración antes de acceder."
    : "";
  return <SignInForm nextPath={safeAuthNext(params.next)} confirmationError={params.error === "confirmation"} notice={notice} />;
}
