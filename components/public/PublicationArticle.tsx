import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { getInlineImageInsertionIndex, splitEditorialParagraphs, type EditorialArticleContent } from "@/lib/editorial-content";
import { ArrowUpRight, CoverArt, SectionLabel } from "./PublicChrome";
import { StoryGallery, type StoryGalleryImage } from "./StoryGallery";
import styles from "@/app/revista/magazine.module.css";

function PullQuote({ children, featured = false }: { children: string; featured?: boolean }) {
  return <blockquote className={featured ? styles.articleLeadQuote : styles.articlePullQuote}><p>“{children}”</p><span>Una voz de la historia</span></blockquote>;
}

export function PublicationAside({ kind = "club", source }: { kind?: "club" | "reference" | "example"; source?: { label: string; href: string } }) {
  return <aside className={styles.articleAside}>
    <div className={styles.asideCard}>
      <strong>{kind === "example" ? "Maqueta editorial" : kind === "reference" ? "Referencia" : "En contexto"}</strong>
      <p>{kind === "example" ? "Este contenido de muestra sirve para revisar el formato de la revista antes de publicar historias propias del club." : kind === "reference" ? "Esta lectura resume información publicada por Rotary International y no sustituye las comunicaciones oficiales." : "Las historias del club pasan por una revisión editorial antes de ser publicadas."}</p>
      {source ? <a className={styles.sourceLink} href={source.href} target="_blank" rel="noreferrer">{source.label} <ArrowUpRight /></a> : null}
    </div>
    <div className={styles.asideCardMuted}><span>¿Quieres participar?</span><Link href="/auth/sign-up?next=/plataforma">Conoce el club <ArrowUpRight /></Link></div>
  </aside>;
}

export function PublicationArticle({ title, excerpt, label, byline, date, editorial, coverSrc, inlineSrc, galleryImages = [], aside, className }: {
  title: string; excerpt: string; label: string; byline: string; date: ReactNode;
  editorial: EditorialArticleContent; coverSrc?: string | null; inlineSrc?: string | null;
  galleryImages?: StoryGalleryImage[]; aside?: ReactNode; className?: string;
}) {
  const paragraphs = splitEditorialParagraphs(editorial.body);
  const insertionIndex = getInlineImageInsertionIndex(editorial, paragraphs.length);
  const supportingImage = inlineSrc ? <figure className={styles.articleInlineFigure} data-alignment={editorial.inlineImageAlignment}>
    <CoverArt src={inlineSrc} alt={editorial.inlineImageAlt || title} className={styles.articleInlineCover} />
    {editorial.inlineImageCaption ? <figcaption>{editorial.inlineImageCaption}</figcaption> : null}
  </figure> : null;

  return <article className={`${styles.editorialStory} ${className ?? ""}`} data-layout={editorial.layoutId}>
    {editorial.layoutId === "voces" && editorial.pullQuote ? <PullQuote featured>{editorial.pullQuote}</PullQuote> : null}
    <div className={`${styles.articleHero} ${editorial.layoutId === "cronica-visual" && coverSrc ? styles.articleHeroSplit : ""}`}>
      <header className={styles.articleHeader}>
        <SectionLabel>{label}</SectionLabel><h1>{title}</h1>
        <p className={styles.articleExcerpt}>{excerpt}</p>
        <div className={styles.articleMeta}><span>{byline}</span>{date}</div>
      </header>
      {coverSrc ? <CoverArt src={coverSrc} alt={editorial.coverImageAlt || title} className={styles.articleCover} priority /> : null}
    </div>
    <div className={aside ? styles.articleLayout : undefined}>
      <div className={styles.articleBody}>
        {paragraphs.map((paragraph, index) => <Fragment key={`${index}-${paragraph.slice(0, 16)}`}>
          {index === insertionIndex ? supportingImage : null}
          <p data-body-paragraph={index + 1}>{paragraph}</p>
          {editorial.layoutId !== "voces" && editorial.pullQuote && index === Math.min(1, paragraphs.length - 1) ? <PullQuote>{editorial.pullQuote}</PullQuote> : null}
        </Fragment>)}
        {insertionIndex === paragraphs.length ? supportingImage : null}
      </div>
      {aside}
    </div>
    <StoryGallery images={galleryImages} />
  </article>;
}
