import type { Metadata } from "next";
import Link from "next/link";

import {
  ArrowLink,
  ArrowUpRight,
  CoverArt,
  PublicShell,
  SectionLabel,
  formatLongDate,
} from "@/components/public/PublicChrome";
import { getEditorialGuides, getPublicStories, type PublicStory } from "@/lib/editorial";

import styles from "./magazine.module.css";

export const metadata: Metadata = {
  title: "Revista",
  description:
    "Historias, ideas y referencias para seguir el servicio del Club Rotario Santo Domingo Colonial.",
};

function StoryCard({ story, featured = false }: { story: PublicStory; featured?: boolean }) {
  return (
    <Link
      className={featured ? `${styles.storyCard} ${styles.storyCardFeatured}` : styles.storyCard}
      href={`/revista/${story.slug}`}
    >
      <CoverArt
        src={story.coverImageUrl ?? story.coverImagePath}
        alt={story.title}
        className={styles.storyCover}
        priority={featured}
      />
      <div className={styles.storyCardBody}>
        <div className={styles.storyMeta}>
          <span>{story.storyTypeLabel}</span>
          {story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : <span>Lectura de referencia</span>}
        </div>
        <h2>{story.title}</h2>
        <p>{story.excerpt}</p>
        <span className={styles.readMore}>Leer la historia <ArrowUpRight /></span>
      </div>
    </Link>
  );
}

export default async function RevistaPage() {
  const [stories] = await Promise.all([getPublicStories(12)]);
  const guides = getEditorialGuides();

  return (
    <PublicShell active="revista">
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <SectionLabel>Revista social · Archivo abierto</SectionLabel>
            <h1>El servicio tiene historias. <em>Aquí las contamos.</em></h1>
            <p>
              Una publicación para mirar de cerca las conversaciones, aprendizajes y acciones que conectan al club con su comunidad.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.buttonPrimary} href="#archivo">Explorar el archivo <ArrowUpRight /></a>
              <Link className={styles.textLink} href="/nosotros#rotary-international">Conocer Rotary <ArrowUpRight /></Link>
            </div>
          </div>
          <div className={styles.heroStamp} aria-label="Identidad editorial de la revista">
            <div className={styles.heroStampTop}><span>SDQ / ZC</span><span>01 — REVISTA</span></div>
            <strong>Personas de acción<br /><em>en primera persona.</em></strong>
            <div className={styles.heroStampBottom}><span>Club Rotario Santo Domingo Colonial</span><span>●</span></div>
          </div>
        </section>

        <section className={styles.archive} id="archivo">
          <div className={styles.sectionHeading}>
            <div>
              <SectionLabel>Historias del club</SectionLabel>
              <h2>Lo que hacemos <span>merece memoria.</span></h2>
            </div>
            <p>Crónicas y voces publicadas por el equipo editorial del club.</p>
          </div>

          {stories.length > 0 ? (
            <div className={styles.storyGrid}>
              {stories.map((story, index) => <StoryCard key={story.id} story={story} featured={index === 0} />)}
            </div>
          ) : (
            <div className={styles.emptyArchive}>
              <div>
                <span className={styles.emptyIndex}>01</span>
                <h3>El archivo está listo para recibir la primera crónica.</h3>
              </div>
              <div>
                <p>
                  Todavía no hay historias propias publicadas. Cuando la directiva y el equipo editorial validen una actividad, aparecerá aquí con su contexto, sus voces y sus aprendizajes.
                </p>
                <a className={styles.readMore} href="mailto:club@rotariosantodomingo.org?subject=Historia%20para%20la%20revista">Compartir una historia <ArrowUpRight /></a>
              </div>
            </div>
          )}
        </section>

        <section className={styles.guides}>
          <div className={styles.sectionHeading}>
            <div>
              <SectionLabel>Lecturas de referencia</SectionLabel>
              <h2>Para entender el movimiento.</h2>
            </div>
            <p>Material informativo basado en fuentes oficiales de Rotary International.</p>
          </div>
          <div className={styles.guideGrid}>
            {guides.map((guide, index) => (
              <StoryCard key={guide.id} story={guide} featured={index === 0} />
            ))}
          </div>
        </section>

        <section className={styles.joinBand}>
          <div>
            <SectionLabel>Una invitación</SectionLabel>
            <h2>La próxima historia también puede empezar contigo.</h2>
          </div>
          <ArrowLink href="/auth/sign-up?next=/plataforma">Quiero conocer el club</ArrowLink>
        </section>
      </main>
    </PublicShell>
  );
}
