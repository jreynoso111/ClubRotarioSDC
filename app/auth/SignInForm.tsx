"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";
import { diagnosticFeedback } from "@/lib/diagnostics-client";
import { endBrowserSession } from "@/lib/auth-session-exit";
import { TurnstileWidget, turnstileSiteKey, type TurnstileHandle } from "@/components/security/TurnstileWidget";

import styles from "./auth.module.css";

export function SignInForm({ nextPath, confirmationError = false, notice = "" }: { nextPath: string; confirmationError?: boolean; notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(confirmationError ? "El enlace no es válido o ha vencido. Solicita uno nuevo o inicia sesión." : "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const captcha = useRef<TurnstileHandle>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    if (turnstileSiteKey && !captchaToken) { setErrorMessage("Completa la verificación de seguridad antes de continuar."); return; }
    setIsSubmitting(true);

    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken: captchaToken || undefined },
      });
      captcha.current?.reset();

      if (error) {
        const message = error.code === "invalid_credentials" ? "El correo o la contraseña no son válidos. Puedes recuperar tu acceso con «Olvidé mi contraseña»."
          : error.code === "email_not_confirmed" ? "Confirma tu correo antes de iniciar sesión."
          : error.status === 429 ? "Demasiados intentos. Espera unos minutos antes de volver a entrar."
          : "No pudimos iniciar sesión. Inténtalo de nuevo.";
        setErrorMessage(await diagnosticFeedback("login", error, message));
        setIsSubmitting(false);
        return;
      }

      const access = await fetch("/api/auth/access", { method: "POST", credentials: "same-origin" });
      if (!access.ok) {
        const result = await access.json();
        await endBrowserSession();
        setErrorMessage(result.state === "pending" ? "Tu cuenta está pendiente de aprobación. Un administrador o responsable autorizado debe activar tu membresía antes de que puedas entrar."
          : result.state === "suspended" ? "Tu membresía está suspendida. Contacta a la administración del club."
          : "No pudimos validar el acceso de tu cuenta. Inténtalo de nuevo más tarde.");
        return;
      }
      const result = await access.json().catch(() => ({})) as { mfa?: string };
      // Privileged roles verify (or enroll) a second factor before administration.
      if (result.mfa === "verify" || result.mfa === "enroll") {
        router.replace(`/auth/mfa?next=${encodeURIComponent(nextPath)}`);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setErrorMessage(await diagnosticFeedback("login", { code: "network_error" }, "No pudimos conectar. Comprueba tu conexión e inténtalo de nuevo."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.card}>
      <Link className={styles.back} href="/">
        ← Club Rotario SDQ Colonial
      </Link>
      <p className={styles.eyebrow}>Acceso de miembros</p>
      <h1 className={styles.title}>Volver al club.</h1>
      <p className={styles.copy}>
        Entra a la plataforma para seguir propuestas, actividades y decisiones del club.
      </p>
      {notice && <p className={styles.success} role="status">{notice}</p>}
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Correo electrónico</span>
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Contraseña</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <TurnstileWidget ref={captcha} action="login" onToken={setCaptchaToken} />
        {errorMessage ? <p role="alert" className={styles.error}>{errorMessage}</p> : null}
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Entrando…" : "Entrar a la plataforma"}
        </button>
      </form>
      <p className={styles.links}><Link className={styles.link} href="/auth/forgot-password">Olvidé mi contraseña</Link></p>
      <p className={styles.links}>
        ¿Todavía no tienes una cuenta?{" "}
        <a className={styles.link} href="/auth/sign-up">
          Solicita acceso
        </a>
      </p>
      <p className={styles.meta}>Un espacio para organizar, colaborar y servir.</p>
    </section>
  );
}
