import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import {
  ArrowLeft,
  ArrowLink,
  ArrowUpRight,
  CoverArt,
  PublicShell,
  SectionLabel,
  formatLongDate,
} from "@/components/public/PublicChrome";
import { getEditorialGuides, getPublicStories, getPublicStory, type PublicStory } from "@/lib/editorial";

import styles from "../magazine.module.css";

type StoryPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getEditorialGuides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: StoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getPublicStory(slug);

  return story
    ? { title: story.title, description: story.excerpt }
    : { title: "Lectura no encontrada" };
}

function StoryBody({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <div className={styles.articleBody}>
      {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>) : <p>El contenido de esta lectura se publicará próximamente.</p>}
    </div>
  );
}

function PullQuote({ children, featured = false }: { children: string; featured?: boolean }) {
  return <blockquote className={featured ? styles.articleLeadQuote : styles.articlePullQuote}><p>“{children}”</p><span>Una voz de la historia</span></blockquote>;
}

function EditorialBody({ editorial }: { editorial: NonNullable<PublicStory["editorial"]> }) {
  const paragraphs = editorial.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const midpoint = Math.max(0, Math.floor((paragraphs.length - 1) / 2));
  const supportingImage = editorial.inlineImagePath ? (
    <figure className={styles.articleInlineFigure} key="supporting-image">
      <CoverArt src={editorial.inlineImageUrl ?? editorial.inlineImagePath} alt={editorial.inlineImageAlt} className={styles.articleInlineCover} />
      {editorial.inlineImageCaption ? <figcaption>{editorial.inlineImageCaption}</figcaption> : null}
    </figure>
  ) : null;
  const quote = editorial.pullQuote ? <PullQuote key="pull-quote">{editorial.pullQuote}</PullQuote> : null;

  return (
    <div className={styles.articleBody}>
      {paragraphs.map((paragraph, index) => (
        <Fragment key={`${index}-${paragraph.slice(0, 16)}`}>
          <p>{paragraph}</p>
          {editorial.layoutId === "cronica-visual" && index === midpoint ? supportingImage : null}
          {editorial.layoutId === "portada" && editorial.pullQuote && index === Math.min(1, paragraphs.length - 1) ? quote : null}
          {editorial.layoutId === "cronica-visual" && editorial.pullQuote && index === Math.min(1, paragraphs.length - 1) ? quote : null}
        </Fragment>
      ))}
      {editorial.layoutId !== "cronica-visual" ? supportingImage : null}
    </div>
  );
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { slug } = await params;
  const story = await getPublicStory(slug);
  if (!story) notFound();

  const recommendations = story.isReference
    ? getEditorialGuides().filter((guide) => guide.slug !== story.slug)
    : (await getPublicStories(4)).filter((item) => item.slug !== story.slug);
  const editorial = story.editorial;

  return (
    <PublicShell active="revista">
      <main className={styles.articleMain}>
        <Link className={styles.backLink} href="/revista"><ArrowLeft /> Volver a la revista</Link>
        <article className={editorial ? styles.editorialStory : undefined} data-layout={editorial?.layoutId}>
          {editorial?.layoutId === "voces" && editorial.pullQuote ? <PullQuote featured>{editorial.pullQuote}</PullQuote> : null}
          <div className={`${styles.articleHero} ${editorial?.layoutId === "cronica-visual" ? styles.articleHeroSplit : ""}`}>
          <header className={styles.articleHeader}>
            <SectionLabel>{story.isExample ? "Ejemplo editorial" : story.isReference ? "Referencia Rotary International" : story.storyTypeLabel}</SectionLabel>
            <h1>{story.title}</h1>
            <p className={styles.articleExcerpt}>{story.excerpt}</p>
            <div className={styles.articleMeta}>
              <span>{story.isExample ? "Texto de muestra" : story.isReference ? "Lectura informativa" : "Publicado por el club"}</span>
              {story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : <span>Contenido editorial</span>}
            </div>
          </header>

          <CoverArt
            src={story.coverImageUrl ?? story.coverImagePath}
            alt={editorial?.coverImageAlt || story.title}
            className={`${styles.articleCover} ${editorial ? styles.editorialCover : ""}`}
            priority
          />
          </div>

          <div className={styles.articleLayout}>
            {editorial ? <EditorialBody editorial={editorial} /> : <StoryBody content={story.content} />}
            <aside className={styles.articleAside}>
              <div className={styles.asideCard}>
                <span className={styles.asideNumber}>01</span>
                <strong>{story.isExample ? "Maqueta editorial" : story.isReference ? "Referencia" : "En contexto"}</strong>
                <p>{story.isExample ? "Este contenido de muestra sirve para revisar el formato de la revista antes de publicar historias propias del club." : story.isReference ? "Esta lectura resume información publicada por Rotary International y no sustituye las comunicaciones oficiales." : "Las historias del club pasan por una revisión editorial antes de ser publicadas."}</p>
                {story.source ? <a className={styles.sourceLink} href={story.source.href} target="_blank" rel="noreferrer">{story.source.label} <ArrowUpRight /></a> : null}
              </div>
              <div className={styles.asideCardMuted}>
                <span>¿Quieres participar?</span>
                <Link href="/auth/sign-up?next=/plataforma">Conoce el club <ArrowUpRight /></Link>
              </div>
            </aside>
          </div>
        </article>

        {recommendations.length > 0 ? (
          <section className={styles.moreReading}>
            <div className={styles.sectionHeading}>
              <div><SectionLabel>Continúa leyendo</SectionLabel><h2>Más historias <span>para llevar.</span></h2></div>
            </div>
            <div className={styles.moreGrid}>
              {recommendations.slice(0, 3).map((item) => (
                <Link key={item.id} href={`/revista/${item.slug}`} className={styles.moreCard}>
                  <span>{item.storyTypeLabel}</span>
                  <strong>{item.title}</strong>
                  <ArrowUpRight />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className={styles.articleCta}><ArrowLink href="/eventos">Ver la agenda pública</ArrowLink></div>
      </main>
    </PublicShell>
  );
}
