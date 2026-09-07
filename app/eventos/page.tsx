import type { Metadata } from "next";
import Link from "next/link";

import {
  ArrowLink,
  ArrowUpRight,
  CoverArt,
  PublicShell,
  SectionLabel,
  formatEventDate,
} from "@/components/public/PublicChrome";
import { getPublicEvents, isUpcoming, type PublicEvent } from "@/lib/editorial";

import AgendaCalendar from "./AgendaCalendar";
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
        <span className={styles.eventMeta}>
          {event.kindLabel} · {date.time} · {isUpcoming(event.startsAt) ? "Próximo" : "Archivo"}
        </span>
        <strong>{event.title}</strong>
        <span>{event.venueName ?? event.summary}</span>
      </span>
      <span className={styles.eventArrow}><ArrowUpRight /></span>
    </Link>
  );
}

function currentMonthKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: "America/Santo_Domingo",
    year: "numeric",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export default async function EventosPage() {
  const events = await getPublicEvents();

  return (
    <PublicShell active="eventos">
      <main className={styles.main}>
        <section className={styles.agendaBanner} aria-labelledby="agenda-title">
          <CoverArt src="/agenda-banner-illustration.webp" alt="Ilustración editorial de un encuentro en una plaza de la Ciudad Colonial" className={styles.agendaBannerArt} priority />
          <div className={styles.agendaBannerContent}>
            <div className={styles.agendaBannerTop}>
              <SectionLabel>Agenda pública · Ciudad Colonial</SectionLabel>
              <span className={styles.agendaBannerDate}>{String(events.length).padStart(2, "0")} ACTIVIDADES</span>
            </div>
            <h1 id="agenda-title">Un calendario para <em>encontrarnos.</em></h1>
            <p>Reuniones, proyectos y espacios de conversación para participar en la vida del club.</p>
          </div>
          <div className={styles.bannerFoot}>
            <span>Encuentros · servicio · comunidad</span>
            <span>Todos los horarios · Santo Domingo</span>
            <span>{String(events.length).padStart(2, "0")} actividades</span>
          </div>
        </section>

        <div className={styles.eventIntro}>
          <p>Todos los horarios se muestran en la zona horaria de Santo Domingo.</p>
          <p>{events.length > 0 ? "Selecciona una fecha o abre una actividad para conocer lugar, descripción y forma de participar." : "La agenda pública se activará cuando el equipo del club publique sus próximas fechas."}</p>
        </div>

        <AgendaCalendar events={events} initialMonth={currentMonthKey()} />

        <section className={styles.scheduleSection} id="lista">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Listado de encuentros</SectionLabel><h2>Todo lo que está programado.</h2></div>
            <span className={styles.eventCount}>{String(events.length).padStart(2, "0")} actividades</span>
          </div>
          {events.length > 0 ? (
            <div className={styles.eventList}>{events.map((event) => <EventCard key={event.id} event={event} />)}</div>
          ) : (
            <div className={styles.emptyEvents}><span>—</span><p>No hay encuentros publicados todavía. Cuando el club confirme una fecha, aparecerá aquí y en el calendario.</p></div>
          )}
        </section>

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
