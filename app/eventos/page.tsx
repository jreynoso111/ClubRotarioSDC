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
          <div className={styles.agendaBannerCopy}>
            <SectionLabel>Agenda pública · Ciudad Colonial</SectionLabel>
            <h1 id="agenda-title">Un calendario para <em>encontrarnos.</em></h1>
            <p>Reuniones, proyectos y espacios de conversación para participar en la vida del club.</p>
            <a className={styles.bannerLink} href="#calendario">Ver el calendario <ArrowUpRight /></a>
          </div>
          <div className={styles.agendaBannerArt} role="img" aria-label="Ilustración editorial de un calendario con fechas del club">
            <div className={styles.artMasthead}><span>AGENDA / SDQ</span><span>2026 · 01</span></div>
            <div className={styles.artCalendar}>
              <div className={styles.artCalendarTitle}><strong>SEPTIEMBRE</strong><span>2026</span></div>
              <div className={styles.artWeekdays}>{["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
              <div className={styles.artDays}>
                {["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"].map((day, index) => (
                  <span className={[day === "14" || day === "28" ? styles.artDayMarked : "", day === "" ? styles.artDayBlank : ""].filter(Boolean).join(" ")} key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
            </div>
            <div className={styles.artFooter}><span>Personas en acción</span><span>●</span></div>
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
