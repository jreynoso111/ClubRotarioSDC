import type { Metadata } from "next";
import Link from "next/link";

import {
  ArrowLink,
  ArrowUpRight,
  PublicShell,
  SectionLabel,
  formatEventDate,
} from "@/components/public/PublicChrome";
import { getPublicEvents, isUpcoming, type PublicEvent } from "@/lib/editorial";

import styles from "./events.module.css";

export const metadata: Metadata = {
  title: "Eventos",
  description:
    "Encuentros, actividades de servicio y conversaciones públicas del Club Rotario Santo Domingo Colonial.",
};

const toneClasses = {
  lime: styles.dateLime,
  sun: styles.dateSun,
  coral: styles.dateCoral,
  teal: styles.dateTeal,
};

function EventCard({ event }: { event: PublicEvent }) {
  const date = formatEventDate(event.startsAt);
  return (
    <Link className={styles.eventCard} href={`/eventos/${event.slug}`}>
      <span className={`${styles.eventDate} ${toneClasses[event.tone]}`}>
        <strong>{date.day}</strong>
        <small>{date.month}</small>
      </span>
      <span className={styles.eventCardBody}>
        <span className={styles.eventMeta}>{event.kindLabel} · {date.time}</span>
        <strong>{event.title}</strong>
        <span>{event.venueName ?? event.summary}</span>
      </span>
      <span className={styles.eventArrow}><ArrowUpRight /></span>
    </Link>
  );
}

function EventSection({
  title,
  label,
  events,
  emptyMessage,
}: {
  title: string;
  label: string;
  events: PublicEvent[];
  emptyMessage: string;
}) {
  return (
    <section className={styles.eventSection}>
      <div className={styles.sectionHeading}>
        <div><SectionLabel>{label}</SectionLabel><h2>{title}</h2></div>
        <span className={styles.eventCount}>{String(events.length).padStart(2, "0")} publicaciones</span>
      </div>
      {events.length > 0 ? (
        <div className={styles.eventList}>{events.map((event) => <EventCard key={event.id} event={event} />)}</div>
      ) : (
        <div className={styles.emptyEvents}><span>—</span><p>{emptyMessage}</p></div>
      )}
    </section>
  );
}

export default async function EventosPage() {
  const events = await getPublicEvents();
  const upcomingEvents = events.filter((event) => isUpcoming(event.startsAt));
  const pastEvents = events.filter((event) => !isUpcoming(event.startsAt)).reverse();

  return (
    <PublicShell active="eventos">
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <SectionLabel>Agenda pública · Ciudad Colonial</SectionLabel>
            <h1>Encontrarnos también es <em>una forma de servir.</em></h1>
            <p>La agenda reúne los espacios donde el club conversa, aprende y coordina acciones abiertas a la comunidad.</p>
            <div className={styles.heroActions}>
              <a className={styles.buttonPrimary} href="#proximos">Ver próximos encuentros <ArrowUpRight /></a>
              <Link className={styles.textLink} href="/revista">Leer las historias <ArrowUpRight /></Link>
            </div>
          </div>
          <div className={styles.heroStamp}>
            <div><span>AGENDA / SDQ</span><span>AMERICA / SANTO DOMINGO</span></div>
            <strong>Tiempo compartido.<br /><em>Acción posible.</em></strong>
            <small>Los detalles se publican al ser confirmados por el club.</small>
          </div>
        </section>

        <div className={styles.eventIntro}>
          <p>Todos los horarios se muestran en la zona horaria de Santo Domingo.</p>
          <p>{events.length > 0 ? "Consulta cada actividad para conocer lugar, descripción y forma de participar." : "La agenda pública se activará cuando el equipo del club publique sus próximas fechas."}</p>
        </div>

        <div id="proximos">
          <EventSection
            label="Lo que sigue"
            title="Próximos encuentros."
            events={upcomingEvents}
            emptyMessage="Todavía no hay actividades públicas con fecha confirmada. Vuelve pronto o escribe al club para recibir novedades."
          />
        </div>

        <EventSection
          label="Archivo de agenda"
          title="Lo que ya pasó."
          events={pastEvents}
          emptyMessage="El archivo de actividades se publicará aquí a medida que el club documente sus encuentros y proyectos."
        />

        <section className={styles.joinBand}>
          <div>
            <SectionLabel>Participa</SectionLabel>
            <h2>¿Quieres enterarte antes de la próxima fecha?</h2>
            <p>Conoce cómo acercarte al club y encontrar la forma de participar que mejor encaje contigo.</p>
          </div>
          <ArrowLink href="/auth/sign-up?next=/plataforma">Quiero conocer el club</ArrowLink>
        </section>
      </main>
    </PublicShell>
  );
}
