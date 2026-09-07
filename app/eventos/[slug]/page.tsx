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
import { getPublicEvent } from "@/lib/editorial";

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

  return (
    <PublicShell active="eventos">
      <main className={styles.detailMain}>
        <Link className={styles.backLink} href="/eventos"><ArrowLeft /> Volver a la agenda</Link>
        <article>
          <header className={styles.detailHeader}>
            <SectionLabel>{event.kindLabel}</SectionLabel>
            <h1>{event.title}</h1>
            <p>{event.summary}</p>
            <div className={styles.detailMeta}>
              <time dateTime={event.startsAt}><strong>{date.day}</strong> {date.month} · {date.time}</time>
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
                {event.locationUrl ? <a href={event.locationUrl} target="_blank" rel="noreferrer">Abrir ubicación <ArrowUpRight /></a> : null}
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
