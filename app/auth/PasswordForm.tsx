"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { createEmailClient } from "@/utils/supabase/email-client";
import { getPublicSiteOrigin } from "@/utils/site-url";
import styles from "./auth.module.css";
import { diagnosticFeedback } from "@/lib/diagnostics-client";
import { endBrowserSession } from "@/lib/auth-session-exit";
import { TurnstileWidget, turnstileSiteKey, type TurnstileHandle } from "@/components/security/TurnstileWidget";

export function PasswordForm({ reset = false }: { reset?: boolean }) {
  const [value, setValue] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const captcha = useRef<TurnstileHandle>(null);

  async function returnToSignIn() {
    await endBrowserSession(true);
    window.location.replace("/auth/sign-in?notice=password-updated");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (reset && value !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!reset && turnstileSiteKey && !captchaToken) { setError("Completa la verificación de seguridad antes de continuar."); return; }
    setBusy(true);
    try {
      const client = createClient();
      if (reset) {
        const { error: updateError } = await client.auth.updateUser({ password: value });
        if (updateError) {
          setError(await diagnosticFeedback("password", updateError, "No pudimos actualizar la contraseña. Comprueba que sea diferente de la anterior o solicita un nuevo enlace."));
          return;
        }
        setPasswordUpdated(true);
        setSuccess("Tu contraseña se actualizó. Debes iniciar sesión con la nueva clave.");
        setValue("");
        setConfirmation("");
        await returnToSignIn();
      } else {
        const checked = await fetch("/api/auth/recovery-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: value.trim() }) });
        if (!checked.ok) {
          setError(checked.status === 429 ? "Has realizado demasiadas consultas. Espera diez minutos antes de volver a intentarlo." : "No pudimos comprobar el correo. Inténtalo de nuevo más tarde.");
          return;
        }
        const account = await checked.json();
        if (!account.exists) { setError("No existe una cuenta registrada con ese correo electrónico. Revisa la dirección o solicita acceso."); return; }
        const { error: requestError } = await createEmailClient().auth.resetPasswordForEmail(value.trim(), {
          redirectTo: `${getPublicSiteOrigin()}/auth/complete?next=/auth/reset-password`,
          captchaToken: captchaToken || undefined,
        });
        captcha.current?.reset();
        if (requestError) {
          setError(await diagnosticFeedback("recovery", requestError, "No pudimos procesar la solicitud. Espera unos minutos e inténtalo de nuevo."));
          return;
        }
        setSuccess("Te enviamos un enlace para recuperar tu contraseña. Revisa también el correo no deseado.");
      }
    } catch {
      setError(await diagnosticFeedback(reset ? "password" : "recovery", { code: "network_error" }, "No pudimos conectar. Comprueba tu conexión e inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.card}>
    <Link className={styles.back} href="/auth/sign-in">← Volver al acceso</Link>
    <p className={styles.eyebrow}>Estamos para ayudarte</p>
    <h1 className={styles.title}>{reset ? "Un nuevo comienzo." : "Recupera tu acceso."}</h1>
    <p className={styles.copy}>{reset ? "Elige una contraseña de al menos 8 caracteres." : "Escribe el correo que usaste para crear tu cuenta y te enviaremos un enlace de recuperación."}</p>
    {!passwordUpdated && <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.label}>{reset ? "Nueva contraseña" : "Correo electrónico"}</span>
        <input className={styles.input} type={reset ? "password" : "email"} autoComplete={reset ? "new-password" : "email"} minLength={reset ? 8 : undefined} required value={value} onChange={event => setValue(event.target.value)} />
      </label>
      {reset && <label className={styles.field}><span className={styles.label}>Repite la nueva contraseña</span><input className={styles.input} type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
      {!reset && <TurnstileWidget ref={captcha} action="recovery" onToken={setCaptchaToken} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {success && <p className={styles.success} role="status">{success}</p>}
      {!(reset && success) && <button className={styles.button} disabled={busy}>{busy ? "Procesando…" : reset ? "Guardar contraseña" : "Enviar enlace"}</button>}
    </form>}
    {passwordUpdated && <><p className={styles.success} role="status">{success}</p>{error && <p role="alert" className={styles.error}>La clave ya cambió. No se pudo completar la salida; vuelve a intentarlo.</p>}<button className={styles.button} disabled={busy} onClick={async () => { setBusy(true); try { await returnToSignIn(); } catch { setError("session_exit_failed"); } finally { setBusy(false); } }}>Iniciar sesión con la nueva clave</button></>}
  </section>;
}
