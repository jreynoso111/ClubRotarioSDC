import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowLeft,
  ArrowLink,
  ArrowUpRight,
  CoverArt,
  PublicShell,
  SectionLabel,
  formatEventDate,
  formatLongDate,
} from "@/components/public/PublicChrome";
import { getPublicEvent, isUpcoming } from "@/lib/editorial";
import { formatClubDate } from "@/lib/club-date";
import { AddToCalendar } from "@/components/public/AddToCalendar";

import styles from "../events.module.css";

type EventPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  return event ? { title: event.title, description: event.summary } : { title: "Evento no encontrado" };
}

function EventDescription({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <div className={styles.eventDescription}>
      {(paragraphs.length > 0 ? paragraphs : ["Los detalles de esta actividad se publicarán próximamente."]).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>)}
    </div>
  );
}

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();

  const date = formatEventDate(event.startsAt);
  const place = [event.venueName, event.venueAddress].filter(Boolean).join(" · ");
  const endTime = event.endsAt ? formatClubDate(event.endsAt).split(", ")[1] : null;
  const upcoming = !event.cancelled && isUpcoming(event.endsAt ?? event.startsAt);

  return (
    <PublicShell active="eventos">
      <main className={styles.detailMain}>
        <Link className={styles.backLink} href="/eventos"><ArrowLeft /> Volver a la agenda</Link>
        <article>
          <header className={styles.detailHeader}>
            <SectionLabel>{event.kindLabel}</SectionLabel>
            {event.cancelled ? <p className={styles.cancelledNotice} role="status">Este evento fue cancelado.</p> : null}
            <h1>{event.title}</h1>
            <p>{event.summary}</p>
            <div className={styles.detailMeta}>
              <time dateTime={event.startsAt}><strong>{date.day}</strong> {date.month} · {date.time}{endTime ? ` – ${endTime}` : ""}</time>
              <span>{place || "Lugar por confirmar"}</span>
            </div>
          </header>
          <CoverArt src={event.coverImageUrl ?? event.coverImagePath} alt={event.title} className={styles.detailCover} priority />
          <div className={styles.detailLayout}>
            <EventDescription content={event.description} />
            <aside className={styles.detailAside}>
              <div className={styles.infoCard}>
                <span className={styles.infoLabel}>Información</span>
                <strong>{formatLongDate(event.startsAt)}</strong>
                <p>{place || "La ubicación se confirmará por los canales del club."}</p>
                {event.capacity !== null ? <p>Cupo: {event.capacity} {event.capacity === 1 ? "persona" : "personas"}.</p> : null}
                {event.locationUrl ? <a href={event.locationUrl} target="_blank" rel="noreferrer">Abrir ubicación <ArrowUpRight /></a> : null}
                {upcoming ? <AddToCalendar className={styles.calendarButton} fileName={event.slug} event={{
                  id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, location: place || null,
                  description: event.summary, url: `https://www.clubrotariosdcolonial.org/eventos/${event.slug}`,
                }} /> : null}
              </div>
              <div className={styles.infoCardMuted}>
                <span>¿No eres miembro todavía?</span>
                <Link href="/auth/sign-up?next=/plataforma">Acercarte al club <ArrowUpRight /></Link>
              </div>
            </aside>
          </div>
        </article>
        <div className={styles.detailCta}><ArrowLink href="/revista">Leer historias del club</ArrowLink></div>
      </main>
    </PublicShell>
  );
}
