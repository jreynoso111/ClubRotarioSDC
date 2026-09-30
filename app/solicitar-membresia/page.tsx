import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell, SectionLabel } from "@/components/public/PublicChrome";

import { MembershipApplicationForm } from "./MembershipApplicationForm";
import styles from "./membership-application.module.css";

export const metadata: Metadata = {
  title: "Quiero ser miembro",
  description: "Comparte tu interés en servir con el Club Rotario Santo Domingo Colonial.",
};

export default function MembershipApplicationPage() {
  return (
    <PublicShell>
      <main className={styles.main}>
        <section className={styles.intro}>
          <Link className={styles.backLink} href="/">← Volver al inicio</Link>
          <SectionLabel>Personas que quieren servir</SectionLabel>
          <h1>Tu próximo capítulo puede empezar <em>sirviendo.</em></h1>
          <p>Cuéntanos un poco sobre ti y sobre las causas que te importan. El equipo del club revisará tu solicitud y se pondrá en contacto contigo.</p>
          <div className={styles.introFoot}><span>Club Rotario Santo Domingo Colonial</span><span>Dar de si antes de pensar en si</span></div>
        </section>

        <section className={styles.applicationSection} aria-labelledby="application-heading">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Solicitud de ingreso</SectionLabel><h2 id="application-heading">Empecemos con <em>una conversación.</em></h2></div>
            <p>Esta solicitud expresa tu interés; no crea una cuenta ni activa automáticamente una membresía.</p>
          </div>
          <MembershipApplicationForm />
        </section>
      </main>
    </PublicShell>
  );
}
