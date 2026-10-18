"use client";

import { useState, useTransition, type FormEvent } from "react";
import { TEMPORARY_PASSWORD_MIN_LENGTH, generateTemporaryPassword } from "@/lib/temporary-password";
import { createMemberAccountAction } from "./member-provisioning-actions";
import styles from "./management.module.css";

export function CreateMemberForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await createMemberAccountAction({ name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""), temporaryPassword: password });
        setNotice(result);
        if (result.ok) { form.reset(); setPassword(""); setShowPassword(false); setOpen(false); onCreated(); }
      } catch { setNotice({ ok: false, message: "No se pudo completar el alta. Inténtalo de nuevo." }); }
    });
  }
  return <article className={styles.card}>
    <div className={styles.heading}><div><h3>Crear un nuevo miembro</h3><p>Crea su cuenta con una contraseña temporal. Al entrar deberá elegir una contraseña propia antes de acceder al sistema.</p></div>
      <button type="button" className={styles.button} disabled={pending} aria-expanded={open} aria-controls="create-member-form"
        onClick={() => { setOpen(value => !value); setPassword(""); setNotice(null); }}>{open ? "Cancelar" : "Crear miembro"}</button>
    </div>
    {open ? <form id="create-member-form" className={`${styles.form} ${styles.createMemberForm}`} onSubmit={submit}>
      <label>Nombre completo<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
      <label>Correo electrónico<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Contraseña temporal<input name="temporaryPassword" type={showPassword ? "text" : "password"} required minLength={TEMPORARY_PASSWORD_MIN_LENGTH} maxLength={64}
        autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <div className={styles.accountViews}>
        <button type="button" className={styles.quietButton} onClick={() => { setPassword(generateTemporaryPassword()); setShowPassword(true); }}>Generar contraseña</button>
        <button type="button" className={styles.quietButton} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}</button>
      </div>
      <p className={styles.muted}>Se crea como miembro aprobado. Entrega la contraseña temporal directamente a la persona; después del alta no se volverá a mostrar.</p>
      <button className={styles.button} disabled={pending}>{pending ? "Creando cuenta…" : "Crear cuenta de miembro"}</button>
    </form> : null}
    {notice ? <p className={`${styles.feedback} ${notice.ok ? "" : styles.error}`} role={notice.ok ? "status" : "alert"}>{notice.message}</p> : null}
  </article>;
}
