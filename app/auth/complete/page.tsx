"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isPendingEmailChange, readEmailSession } from "@/lib/email-session";
import { createClient } from "@/utils/supabase/client";
import styles from "../auth.module.css";
import { reportClientDiagnostic } from "@/lib/diagnostics-client";
import { endBrowserSession } from "@/lib/auth-session-exit";

export default function CompleteEmailPage() {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const [awaitingOtherEmail, setAwaitingOtherEmail] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const session = readEmailSession(window.location.hash);
    const pendingEmailChange = isPendingEmailChange(window.location.hash);
    // Remove bearer credentials before making any network request. Fragments
    // are never sent to the web server, reverse proxy or referrer headers.
    window.history.replaceState(null, "", window.location.pathname);
    if (!session && pendingEmailChange) { void Promise.resolve().then(() => setAwaitingOtherEmail(true)); return; }
    if (!session) {
      void reportClientDiagnostic("confirmation", undefined, "otp_expired");
      router.replace("/auth/sign-in?error=confirmation");
      return;
    }
    async function finish() {
      try {
        const { error } = await createClient().auth.setSession({ access_token: session!.accessToken, refresh_token: session!.refreshToken });
        if (error) { await reportClientDiagnostic("confirmation", error); setFailed(true); return; }
        if (session!.destination.startsWith("/auth/sign-in")) {
          await endBrowserSession();
          window.location.replace(session!.destination);
          return;
        }
        router.replace(session!.destination);
        router.refresh();
      } catch { await reportClientDiagnostic("confirmation", undefined, "network_error"); setFailed(true); }
    }
    void finish();
  }, [router]);

  if (awaitingOtherEmail) return <section className={styles.card}>
    <h1 className={styles.title}>Falta un paso para cambiar tu correo.</h1>
    <p className={styles.copy} role="status">Confirmamos una de las direcciones. Abre también el enlace que enviamos a la otra para terminar el cambio.</p>
    <Link className={styles.link} href="/plataforma?tab=perfil">Volver a Mi cuenta</Link>
  </section>;

  return <section className={styles.card}>
    <h1 className={styles.title}>{failed ? "No pudimos confirmar el acceso." : "Confirmando tu acceso…"}</h1>
    <p className={styles.copy} role="status">{failed ? "Solicita un enlace nuevo e inténtalo otra vez." : "Un momento mientras conectamos tu cuenta con el club."}</p>
    {failed && <Link className={styles.link} href="/auth/forgot-password">Solicitar otro enlace</Link>}
  </section>;
}
