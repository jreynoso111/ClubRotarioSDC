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

function StoryCard({
  story,
  featured = false,
  compact = false,
}: {
  story: PublicStory;
  featured?: boolean;
  compact?: boolean;
}) {
  const cardClassName = [
    styles.storyCard,
    featured && styles.storyCardFeatured,
    compact && styles.storyCardCompact,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      className={cardClassName}
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
        <span className={styles.readMore}>Abrir publicación <ArrowUpRight /></span>
      </div>
    </Link>
  );
}

export default async function RevistaPage() {
  const [stories] = await Promise.all([getPublicStories(12)]);
  const guides = getEditorialGuides();
  const publications = stories.length > 0 ? stories : guides;
  const hasClubStories = stories.length > 0;
  const currentYear = new Date().getFullYear();

  return (
    <PublicShell active="revista">
      <main className={styles.main}>
        <section className={styles.magazineBanner} aria-labelledby="revista-title">
          <div className={styles.bannerMasthead}>
            <span>Club Rotario Santo Domingo Colonial</span>
            <strong>Revista Colonial</strong>
            <span>Edición abierta · {currentYear}</span>
          </div>
          <div className={styles.bannerIntro}>
            <div className={styles.bannerTitle}>
              <SectionLabel>Revista social · Publicaciones</SectionLabel>
              <h1 id="revista-title">El servicio <em>en primera plana.</em></h1>
            </div>
            <div className={styles.bannerAside}>
              <p>
                Crónicas, ideas y memoria para mirar de cerca cómo el club se conecta con su comunidad.
              </p>
              <a className={styles.bannerLink} href="#archivo">Explorar publicaciones <ArrowUpRight /></a>
            </div>
          </div>
          <div className={styles.bannerFoot}>
            <span>Historias · ideas · memoria</span>
            <span>Ciudad Colonial · Santo Domingo</span>
            <span>Vol. 01</span>
          </div>
        </section>

        <section className={styles.issue} id="archivo">
          <div className={styles.sectionHeading}>
            <div>
              <SectionLabel>{hasClubStories ? "Crónicas del club" : "Edición de referencia"}</SectionLabel>
              <h2>Publicaciones <span>para quedarse.</span></h2>
            </div>
            <p>
              {hasClubStories
                ? "Crónicas y voces publicadas por el equipo editorial del club."
                : "Una selección de lecturas para conocer el movimiento y su manera de servir."}
            </p>
          </div>

          {publications.length > 0 ? (
            <>
              <div className={styles.newspaperGrid}>
                <StoryCard story={publications[0]} featured />
                {publications.length > 1 ? (
                  <div className={styles.newspaperStack}>
                    {publications.slice(1, 4).map((publication) => (
                      <StoryCard key={publication.id} story={publication} compact />
                    ))}
                  </div>
                ) : null}
              </div>
              {publications.length > 4 ? (
                <div className={styles.newspaperArchive}>
                  {publications.slice(4).map((publication) => (
                    <StoryCard key={publication.id} story={publication} compact />
                  ))}
                </div>
              ) : null}
            </>
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

        {hasClubStories && guides.length > 0 ? (
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
        ) : null}

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
