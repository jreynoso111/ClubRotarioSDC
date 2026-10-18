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
import { getPublicStories, getPublicStory, type PublicStory } from "@/lib/editorial";
import { PublicationArticle, PublicationAside } from "@/components/public/PublicationArticle";
import type { EditorialArticleContent } from "@/lib/editorial-content";
import { getPublicSiteOrigin } from "@/utils/site-url";

import styles from "../magazine.module.css";

type StoryPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: StoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getPublicStory(slug);

  if (!story) {
    return { title: "Historia no encontrada", robots: { index: false, follow: false } };
  }

  const origin = getPublicSiteOrigin();
  const url = `${origin}/revista/${story.slug}`;
  const imageUrl = story.coverImageUrl?.startsWith("/") ? `${origin}${story.coverImageUrl}` : story.coverImageUrl;
  const images = imageUrl
    ? [{ url: imageUrl, alt: story.editorial?.coverImageAlt || story.title }]
    : undefined;

  return {
    title: story.title,
    description: story.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: story.title,
      description: story.excerpt,
      publishedTime: story.publishedAt ?? undefined,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: story.title,
      description: story.excerpt,
      images: images?.map((image) => image.url),
    },
  };
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
  // Throws when the store is unavailable, so only a successful lookup with no row becomes a 404.
  const story = await getPublicStory(slug);
  if (!story) notFound();

  const recommendations = (await getPublicStories(4)).filter((item) => item.slug !== story.slug).slice(0, 3);
  const editorial = contentForStory(story);
  const galleryUrls = story.editorial?.galleryImageUrls ?? [];
  const galleryImages = editorial.gallery.flatMap((image, index) => {
    const src = galleryUrls[index];
    return src ? [{ src, alt: image.alt, caption: image.caption }] : [];
  });

  return (
    <PublicShell active="revista">
      <main className={styles.articleMain}>
        <Link className={styles.backLink} href="/revista"><ArrowLeft /> Volver a la revista</Link>
        <PublicationArticle title={story.title} excerpt={story.excerpt}
          label={story.storyTypeLabel}
          byline="Publicado por el club"
          date={story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : <span>Contenido editorial</span>}
          editorial={editorial} coverSrc={story.coverImageUrl}
          inlineSrc={story.editorial?.inlineImageUrl ?? null}
          galleryImages={galleryImages}
          aside={<PublicationAside />} />

        {recommendations.length > 0 ? (
          <section className={styles.moreReading}>
            <div className={styles.sectionHeading}>
              <div><p className={styles.readingLabel}>Continúa leyendo</p><h2>Más historias <span>para llevar.</span></h2></div>
            </div>
            <div className={styles.moreGrid}>
              {recommendations.map((item) => (
                <Link key={item.id} href={`/revista/${item.slug}`} className={styles.moreCard}>
                  <CoverArt src={item.coverImageUrl} alt={item.editorial?.coverImageAlt || item.title} className={styles.moreCover} />
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
