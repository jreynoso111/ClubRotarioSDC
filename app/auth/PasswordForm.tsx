"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import styles from "./auth.module.css";

export function PasswordForm({ reset = false }: { reset?: boolean }) {
  const [value, setValue] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (reset && value !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const client = createClient();
      if (reset) {
        const { error: updateError } = await client.auth.updateUser({ password: value });
        if (updateError) {
          setError("No pudimos actualizar la contraseña. Comprueba que sea diferente de la anterior o solicita un nuevo enlace.");
          return;
        }
        setSuccess("Tu contraseña se actualizó. Ya puedes continuar a la plataforma.");
        setValue("");
        setConfirmation("");
      } else {
        const { error: requestError } = await client.auth.resetPasswordForEmail(value.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
        });
        if (requestError) {
          setError("No pudimos procesar la solicitud. Espera unos minutos e inténtalo de nuevo.");
          return;
        }
        setSuccess("Si hay una cuenta asociada, recibirás un enlace para recuperar tu contraseña. Revisa también el correo no deseado.");
      }
    } catch {
      setError("No pudimos conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.card}>
    <Link className={styles.back} href="/auth/sign-in">← Volver al acceso</Link>
    <p className={styles.eyebrow}>Estamos para ayudarte</p>
    <h1 className={styles.title}>{reset ? "Un nuevo comienzo." : "Recupera tu acceso."}</h1>
    <p className={styles.copy}>{reset ? "Elige una contraseña de al menos 8 caracteres." : "Escribe el correo que usaste para crear tu cuenta y te enviaremos un enlace de recuperación."}</p>
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.label}>{reset ? "Nueva contraseña" : "Correo electrónico"}</span>
        <input className={styles.input} type={reset ? "password" : "email"} autoComplete={reset ? "new-password" : "email"} minLength={reset ? 8 : undefined} required value={value} onChange={event => setValue(event.target.value)} />
      </label>
      {reset && <label className={styles.field}><span className={styles.label}>Repite la nueva contraseña</span><input className={styles.input} type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {success && <p className={styles.success} role="status">{success}</p>}
      {!(reset && success) && <button className={styles.button} disabled={busy}>{busy ? "Procesando…" : reset ? "Guardar contraseña" : "Enviar enlace"}</button>}
    </form>
    {reset && success && <p className={styles.links}><Link className={styles.link} href="/plataforma">Continuar a la plataforma →</Link></p>}
  </section>;
}
