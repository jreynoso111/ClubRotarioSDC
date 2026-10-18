"use client";

import { useState, useTransition, type FormEvent } from "react";
import { completeInitialPasswordAction } from "./actions";
import { endBrowserSession } from "@/lib/auth-session-exit";
import styles from "../auth.module.css";

export function FirstPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    startTransition(async () => {
      try {
        const result = await completeInitialPasswordAction(password, confirmation);
        if (!result.ok) { setError(result.message); return; }
        setPassword(""); setConfirmation("");
        window.location.replace("/auth/sign-in?notice=password-updated");
      } catch { setError("No se pudo completar el cambio. Inténtalo de nuevo."); }
    });
  }
  return <section className={styles.card}>
    <p className={styles.eyebrow}>Primer acceso</p><h1 className={styles.title}>Tu propia contraseña.</h1>
    <p className={styles.copy}>La administración creó tu cuenta con una contraseña temporal. Elige una diferente para continuar. Después iniciarás sesión con tu nueva clave.</p>
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}><span className={styles.label}>Nueva contraseña</span><input className={styles.input} type="password" autoComplete="new-password" required minLength={8} maxLength={64} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className={styles.field}><span className={styles.label}>Repite la nueva contraseña</span><input className={styles.input} type="password" autoComplete="new-password" required minLength={8} maxLength={64} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Establecer mi contraseña"}</button>
    </form>
    <button type="button" className={styles.link} disabled={pending} onClick={() => {
      startTransition(async () => { try { await endBrowserSession(); window.location.replace("/auth/sign-in"); } catch { setError("No se pudo cerrar la sesión. Inténtalo de nuevo."); } });
    }}>Cerrar sesión</button>
  </section>;
}
