"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  submitMembershipApplicationAction,
  type MembershipApplicationFormState,
} from "./actions";
import styles from "./membership-application.module.css";

const initialState: MembershipApplicationFormState = { ok: false, message: "" };

export function MembershipApplicationForm() {
  const [state, formAction, pending] = useActionState(submitMembershipApplicationAction, initialState);

  if (state.ok) {
    return (
      <div className={styles.successPanel} role="status">
        <span>Solicitud enviada</span>
        <h2>Gracias por querer servir con nosotros.</h2>
        <p>{state.message}</p>
        <Link href="/">Volver al inicio</Link>
      </div>
    );
  }

  return (
    <form className={styles.form} action={formAction}>
      <label className={styles.honeypot} aria-hidden="true">
        Sitio web
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <div className={styles.fieldsTwo}>
        <label>Nombre completo<input name="fullName" autoComplete="name" required minLength={2} maxLength={120} /></label>
        <label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label>Teléfono<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={40} placeholder="+1 809 555 0100" /></label>
        <label>Profesión u ocupación <span>(opcional)</span><input name="occupation" autoComplete="organization-title" maxLength={120} /></label>
      </div>
      <label>¿Quién te habló del club? <span>(opcional)</span><input name="referralSource" maxLength={120} placeholder="Nombre de la persona o cómo nos encontraste" /></label>
      <label>¿Qué te motiva a acercarte a Rotary?<textarea name="motivation" required minLength={20} maxLength={2000} rows={5} placeholder="Cuéntanos sobre las causas que te mueven y cómo te gustaría aportar." /></label>

      <div className={styles.privacyNotice} id="privacy-note">
        <strong>Transparencia sobre tus datos</strong>
        <p>Tu nombre, contacto, ocupación y respuestas estarán disponibles para los miembros activos del club y su presidencia para conocerte y dar seguimiento a tu solicitud. No incluyas información que prefieras mantener privada.</p>
      </div>
      <label className={styles.consent}>
        <input name="consent" type="checkbox" value="yes" required aria-describedby="privacy-note" />
        <span>Autorizo que estos datos se compartan con los miembros activos del Club Rotario Santo Domingo Colonial y su presidencia para evaluar mi interés.</span>
      </label>

      {state.message ? <p className={styles.error} role="alert">{state.message}</p> : null}
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Enviando solicitud…" : "Enviar solicitud"}<span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
