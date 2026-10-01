import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowLeft,
  ArrowLink,
  ArrowUpRight,
  CoverArt,
  PublicShell,
  formatLongDate,
} from "@/components/public/PublicChrome";
import { getEditorialGuides, getPublicStories, getPublicStory, type PublicStory } from "@/lib/editorial";
import { PublicationArticle, PublicationAside } from "@/components/public/PublicationArticle";
import type { EditorialArticleContent } from "@/lib/editorial-content";

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

function contentForStory(story: PublicStory): EditorialArticleContent {
  return story.editorial ?? {
    layoutId: "portada", body: story.content, pullQuote: "", coverImageAlt: story.title,
    inlineImagePath: null, inlineImageAlt: "", inlineImageCaption: "", inlineImageAfterParagraph: 0,
    inlineImageAlignment: "right", gallery: [],
  };
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { slug } = await params;
  const story = await getPublicStory(slug);
  if (!story) notFound();

  const recommendations = story.isReference
    ? getEditorialGuides().filter((guide) => guide.slug !== story.slug)
    : (await getPublicStories(4)).filter((item) => item.slug !== story.slug);
  const editorial = contentForStory(story);

  return (
    <PublicShell active="revista">
      <main className={styles.articleMain}>
        <Link className={styles.backLink} href="/revista"><ArrowLeft /> Volver a la revista</Link>
        <PublicationArticle title={story.title} excerpt={story.excerpt}
          label={story.isExample ? "Ejemplo editorial" : story.isReference ? "Referencia Rotary International" : story.storyTypeLabel}
          byline={story.isExample ? "Texto de muestra" : story.isReference ? "Lectura informativa" : "Publicado por el club"}
          date={story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : <span>Contenido editorial</span>}
          editorial={editorial} coverSrc={story.coverImageUrl ?? story.coverImagePath}
          inlineSrc={story.editorial?.inlineImageUrl ?? editorial.inlineImagePath}
          galleryImages={editorial.gallery.map((image, index) => ({ src: story.editorial?.galleryImageUrls?.[index] ?? image.path, alt: image.alt, caption: image.caption }))}
          aside={<PublicationAside kind={story.isExample ? "example" : story.isReference ? "reference" : "club"} source={story.source} />} />

        {recommendations.length > 0 ? (
          <section className={styles.moreReading}>
            <div className={styles.sectionHeading}>
              <div><p className={styles.readingLabel}>Continúa leyendo</p><h2>Más historias <span>para llevar.</span></h2></div>
            </div>
            <div className={styles.moreGrid}>
              {recommendations.slice(0, 3).map((item) => (
                <Link key={item.id} href={`/revista/${item.slug}`} className={styles.moreCard}>
                  <CoverArt src={item.coverImageUrl ?? item.coverImagePath} alt={item.editorial?.coverImageAlt || item.title} className={styles.moreCover} />
                  <div className={styles.moreCardBody}><span>{item.storyTypeLabel}</span><strong>{item.title}</strong><ArrowUpRight /></div>
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
