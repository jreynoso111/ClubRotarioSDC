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
  formatLongDate,
} from "@/components/public/PublicChrome";
import { getEditorialGuides, getPublicStories, getPublicStory } from "@/lib/editorial";

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

export default async function StoryPage({ params }: StoryPageProps) {
  const { slug } = await params;
  const story = await getPublicStory(slug);
  if (!story) notFound();

  const recommendations = story.isReference
    ? getEditorialGuides().filter((guide) => guide.slug !== story.slug)
    : (await getPublicStories(4)).filter((item) => item.slug !== story.slug);

  return (
    <PublicShell active="revista">
      <main className={styles.articleMain}>
        <Link className={styles.backLink} href="/revista"><ArrowLeft /> Volver a la revista</Link>
        <article>
          <header className={styles.articleHeader}>
            <SectionLabel>{story.isReference ? "Referencia Rotary International" : story.storyTypeLabel}</SectionLabel>
            <h1>{story.title}</h1>
            <p className={styles.articleExcerpt}>{story.excerpt}</p>
            <div className={styles.articleMeta}>
              <span>{story.isReference ? "Lectura informativa" : "Publicado por el club"}</span>
              {story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : <span>Contenido editorial</span>}
            </div>
          </header>

          <CoverArt
            src={story.coverImageUrl ?? story.coverImagePath}
            alt={story.title}
            className={styles.articleCover}
            priority
          />

          <div className={styles.articleLayout}>
            <StoryBody content={story.content} />
            <aside className={styles.articleAside}>
              <div className={styles.asideCard}>
                <span className={styles.asideNumber}>01</span>
                <strong>{story.isReference ? "Referencia" : "En contexto"}</strong>
                <p>{story.isReference ? "Esta lectura resume información publicada por Rotary International y no sustituye las comunicaciones oficiales." : "Las historias del club pasan por una revisión editorial antes de ser publicadas."}</p>
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
