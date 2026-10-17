"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";
import { diagnosticFeedback } from "@/lib/diagnostics-client";
import { endBrowserSession } from "@/lib/auth-session-exit";

import styles from "./auth.module.css";

type Stage = "loading" | "verify" | "enroll" | "scan" | "error";
type Enrollment = { factorId: string; qr: string; secret: string };

const codePattern = /^\d{6}$/;

function qrSource(value: string) {
  return value.startsWith("data:") ? value : `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

export function MfaForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => { try {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (cancelled) return;
      if (error) { setMessage(await diagnosticFeedback("mfa", error, "No pudimos consultar tus factores de verificación.")); setStage("error"); return; }
      const verified = data.totp[0];
      if (verified) { setFactorId(verified.id); setStage("verify"); } else setStage("enroll");
    } catch { if (!cancelled) { setMessage("No pudimos consultar tu configuración. Recarga la página para volver a intentarlo."); setStage("error"); } }
    })();
    return () => { cancelled = true; };
  }, []);

  async function startEnrollment() {
    setBusy(true); setMessage("");
    const mfa = createClient().auth.mfa;
    try {
      // Abandoned enrollments stay unverified; remove them so a new QR code can be issued.
      const { data: existing } = await mfa.listFactors();
      for (const factor of existing?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") await mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await mfa.enroll({ factorType: "totp", friendlyName: `Autenticador ${new Date().toISOString().slice(0, 10)}`, issuer: "Club Rotario SDQ Colonial" });
      if (error || !data) { setMessage(await diagnosticFeedback("mfa", error ?? undefined, "No pudimos iniciar la configuración.")); return; }
      setEnrollment({ factorId: data.id, qr: qrSource(data.totp.qr_code), secret: data.totp.secret });
      setFactorId(data.id);
      setStage("scan");
    } catch {
      setMessage(await diagnosticFeedback("mfa", { code: "network_error" }, "No pudimos conectar. Inténtalo de nuevo."));
    } finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = code.replace(/\s+/g, "");
    if (!codePattern.test(value)) { setMessage("Escribe el código de 6 dígitos de tu aplicación de autenticación."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: value });
      if (error) {
        setMessage(await diagnosticFeedback("mfa", error, error.status === 429 ? "Demasiados intentos. Espera unos minutos." : "El código no es válido o ya venció. Usa el código actual de tu aplicación."));
        setCode("");
        return;
      }
      setEnrollment(null);
      setCode("");
      const access = await fetch("/api/auth/access", { method: "POST", credentials: "same-origin" });
      const state = await access.json();
      if (!access.ok || (state.mfa !== "verified" && state.mfa !== "not_required")) {
        await endBrowserSession();
        window.location.replace("/auth/sign-in?notice=session-expired");
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setMessage(await diagnosticFeedback("mfa", { code: "network_error" }, "No pudimos conectar. Inténtalo de nuevo."));
    } finally { setBusy(false); }
  }

  const codeForm = (
    <form className={styles.form} onSubmit={verify}>
      <label className={styles.field}>
        <span className={styles.label}>Código de 6 dígitos</span>
        <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={event => setCode(event.target.value)} />
      </label>
      {message ? <p role="alert" className={styles.error}>{message}</p> : null}
      <button className={styles.button} type="submit" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
    </form>
  );

  return (
    <section className={styles.card}>
      <Link className={styles.back} href="/plataforma">← Plataforma del club</Link>
      <p className={styles.eyebrow}>Seguridad de la cuenta</p>
      <h1 className={styles.title}>Verificación en dos pasos.</h1>
      {stage === "loading" && <p className={styles.copy} role="status">Consultando tu configuración…</p>}
      {stage === "error" && <p role="alert" className={styles.error}>{message}</p>}
      {stage === "verify" && <>
        <p className={styles.copy}>Las funciones de administración y finanzas requieren confirmar tu identidad cada 12 horas. Abre tu aplicación de autenticación y escribe el código actual.</p>
        {codeForm}
      </>}
      {stage === "enroll" && <>
        <p className={styles.copy}>Tu rol administra datos sensibles del club. Para usar esas funciones, vincula una aplicación de autenticación (por ejemplo Google Authenticator, Microsoft Authenticator o 1Password). Sin este paso, tu cuenta funciona como la de un miembro.</p>
        {message ? <p role="alert" className={styles.error}>{message}</p> : null}
        <button className={styles.button} type="button" onClick={startEnrollment} disabled={busy}>{busy ? "Preparando…" : "Configurar aplicación de autenticación"}</button>
      </>}
      {stage === "scan" && enrollment && <>
        <p className={styles.copy}>Escanea este código con tu aplicación. Si no puedes escanearlo, introduce la clave manualmente. No la compartas ni la guardes en este equipo.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated by Auth, never remote */}
        <img src={enrollment.qr} alt="Código QR para la aplicación de autenticación" width={200} height={200} style={{ background: "#fff", display: "block", margin: "0 auto 16px" }} />
        <details className={styles.copy}><summary>Mostrar clave manual</summary><code style={{ wordBreak: "break-all" }}>{enrollment.secret}</code></details>
        {codeForm}
      </>}
      <p className={styles.links}><Link className={styles.link} href="/plataforma">Continuar sin funciones de administración</Link></p>
      <p className={styles.meta}>Si pierdes acceso a tu aplicación, otro administrador no puede desactivarla por ti: contacta al responsable técnico del servidor del club.</p>
    </section>
  );
}
