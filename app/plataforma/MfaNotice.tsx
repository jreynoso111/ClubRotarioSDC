"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./mfa-notice.module.css";

// The notice changes wording and escalates in tone across visits so a pending
// second factor never settles into the background of the dashboard.
const viewsKey = "club-mfa-notice-views";
const snoozeKey = "club-mfa-notice-snoozed";
const urgentAfterViews = 4;

const copy = {
  enroll: {
    action: "Activar ahora",
    titles: [
      "Tu cuenta necesita verificación en dos pasos.",
      "Protege el acceso a las finanzas y la administración del club.",
      "Un paso de dos minutos reactiva tus funciones de gestión.",
    ],
    body: "Las funciones de administración y finanzas de tu rol están en pausa hasta que vincules una aplicación de autenticación. Mientras tanto, usas la plataforma como miembro.",
    compact: "Verificación en dos pasos pendiente",
  },
  verify: {
    action: "Verificar ahora",
    titles: [
      "Confirma tu verificación en dos pasos.",
      "Introduce tu código para recuperar tus funciones de gestión.",
      "Tu sesión necesita el código de tu aplicación de autenticación.",
    ],
    body: "Las funciones de administración y finanzas de tu rol están en pausa hasta que introduzcas el código de tu aplicación de autenticación. Mientras tanto, usas la plataforma como miembro.",
    compact: "Código de verificación pendiente",
  },
} as const;

function readNumber(storage: () => Storage, key: string) {
  try { return Number(storage().getItem(key)) || 0; } catch { return 0; }
}

function write(storage: () => Storage, key: string, value: string) {
  try { storage().setItem(key, value); } catch { /* storage may be unavailable */ }
}

export function MfaNotice({ state }: { state: "enroll" | "verify" }) {
  const [views, setViews] = useState(0);
  const [snoozed, setSnoozed] = useState(false);
  const text = copy[state];

  useEffect(() => {
    const next = readNumber(() => window.localStorage, viewsKey) + 1;
    write(() => window.localStorage, viewsKey, String(next));
    // Reading browser storage has to wait until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(next);
    setSnoozed(readNumber(() => window.sessionStorage, snoozeKey) === 1);
  }, []);

  const urgent = views >= urgentAfterViews;
  const tone = urgent ? styles.urgent : styles.warning;
  const href = "/auth/mfa?next=/plataforma";

  if (snoozed) {
    return <div className={`${styles.compact} ${tone}`} role="status">
      <ShieldIcon />
      <span>{text.compact}</span>
      <Link href={href} className={styles.compactAction}>{text.action} →</Link>
    </div>;
  }

  return <section className={`${styles.notice} ${tone}`} role="status" aria-labelledby="mfa-notice-title">
    <span className={styles.icon}><ShieldIcon /></span>
    <div className={styles.copy}>
      <p className={styles.eyebrow}>{urgent ? "Acción requerida" : "Seguridad de la cuenta"}</p>
      <h2 id="mfa-notice-title">{text.titles[views % text.titles.length]}</h2>
      <p className={styles.body}>{text.body}</p>
    </div>
    <div className={styles.actions}>
      <Link href={href} className={styles.primary}>{text.action}</Link>
      <button type="button" className={styles.secondary} onClick={() => { write(() => window.sessionStorage, snoozeKey, "1"); setSnoozed(true); }}>
        Recordármelo luego
      </button>
    </div>
  </section>;
}

function ShieldIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z" />
    <rect x="9" y="11" width="6" height="5" rx="1" />
    <path d="M10.2 11V9.6a1.8 1.8 0 0 1 3.6 0V11" />
  </svg>;
}
