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
import { getPublicStoriesPage, type PublicStory } from "@/lib/editorial";
import { getSitePhotos } from "@/lib/site-photo-slots";
import { getPublicSiteOrigin } from "@/utils/site-url";

import styles from "./magazine.module.css";

const PUBLICATION_PAGE_SIZE = 9;
const REVISTA_DESCRIPTION =
  "Historias, ideas y referencias para seguir el servicio del Club Rotario Santo Domingo Colonial.";

type RevistaPageProps = {
  searchParams: Promise<{ pagina?: string }>;
};

function parsePage(value?: string) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function getPageHref(page: number) {
  return page === 1 ? "/revista" : `/revista?pagina=${page}`;
}

function getPaginationItems(totalPages: number, currentPage: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const visiblePages = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page > 0 && page <= totalPages)),
  ).sort((left, right) => left - right);

  return visiblePages.flatMap((page, index) => {
    const previousPage = visiblePages[index - 1];
    return index > 0 && page - previousPage > 1 ? ["ellipsis", page] : [page];
  });
}

export const metadata: Metadata = {
  title: "Revista",
  description: REVISTA_DESCRIPTION,
  openGraph: {
    title: "Revista · Club Rotario Santo Domingo Colonial",
    description: REVISTA_DESCRIPTION,
    url: `${getPublicSiteOrigin()}/revista`,
    siteName: "Club Rotario Santo Domingo Colonial",
    locale: "es_DO",
    type: "website",
  },
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
        src={story.coverImageUrl}
        alt={story.title}
        className={styles.storyCover}
        priority={featured}
      />
      <div className={styles.storyCardBody}>
        <div className={styles.storyMeta}>
          <span>{story.storyTypeLabel}</span>
          {story.publishedAt ? <time dateTime={story.publishedAt}>{formatLongDate(story.publishedAt)}</time> : null}
        </div>
        <h2>{story.title}</h2>
        <p>{story.excerpt}</p>
        <span className={styles.readMore}>Leer publicación <ArrowUpRight /></span>
      </div>
    </Link>
  );
}

export default async function RevistaPage({ searchParams }: RevistaPageProps) {
  const params = await searchParams;
  const requestedPage = parsePage(params.pagina);
  const [publicationPage, photos] = await Promise.all([
    getPublicStoriesPage(requestedPage, PUBLICATION_PAGE_SIZE),
    getSitePhotos(),
  ]);
  const publications = publicationPage.stories;
  const totalPages = Math.max(1, Math.ceil(publicationPage.total / publicationPage.pageSize));
  const paginationItems = getPaginationItems(totalPages, publicationPage.page);
  const currentYear = new Date().getFullYear();

  return (
    <PublicShell active="revista">
      <main className={styles.main}>
        <section className={styles.magazineBanner} aria-labelledby="revista-title">
          <CoverArt src={photos["revista-banner"].url} alt={photos["revista-banner"].alt} className={styles.magazineBannerArt} priority />
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
            </div>
          </div>
          <div className={styles.bannerFoot}>
            <span>Historias · ideas · memoria</span>
            <span>Ciudad Colonial · Santo Domingo</span>
            <span>Vol. 01</span>
          </div>
        </section>

        {publications.length > 0 ? (
          <section className={styles.issue} id="archivo" aria-label="Publicaciones de revista">
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
            {totalPages > 1 ? (
              <nav className={styles.pagination} aria-label="Paginación de publicaciones">
                <div className={styles.paginationMeta}>
                  Página {publicationPage.page} de {totalPages}
                </div>
                <div className={styles.paginationPages}>
                  {publicationPage.page > 1 ? (
                    <Link className={styles.paginationButton} href={getPageHref(publicationPage.page - 1)} rel="prev">
                      <span aria-hidden="true">←</span> Anteriores
                    </Link>
                  ) : (
                    <span className={`${styles.paginationButton} ${styles.paginationDisabled}`} aria-hidden="true">
                      <span aria-hidden="true">←</span> Anteriores
                    </span>
                  )}
                  <div className={styles.paginationNumbers}>
                    {paginationItems.map((item, index) => item === "ellipsis" ? (
                      <span className={styles.paginationEllipsis} key={`ellipsis-${index}`} aria-hidden="true">…</span>
                    ) : (
                      <Link
                        className={`${styles.paginationNumber} ${item === publicationPage.page ? styles.paginationNumberActive : ""}`}
                        href={getPageHref(item)}
                        aria-current={item === publicationPage.page ? "page" : undefined}
                        key={`page-${item}`}
                      >
                        {String(item).padStart(2, "0")}
                      </Link>
                    ))}
                  </div>
                  {publicationPage.page < totalPages ? (
                    <Link className={styles.paginationButton} href={getPageHref(publicationPage.page + 1)} rel="next">
                      Siguientes <span aria-hidden="true">→</span>
                    </Link>
                  ) : (
                    <span className={`${styles.paginationButton} ${styles.paginationDisabled}`} aria-hidden="true">
                      <span aria-hidden="true">→</span>
                    </span>
                  )}
                </div>
              </nav>
            ) : null}
          </section>
        ) : (
          <section className={styles.issueEmpty}>
            <p className={styles.issueEmptyText}>Pronto publicaremos las primeras historias del club.</p>
          </section>
        )}

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
