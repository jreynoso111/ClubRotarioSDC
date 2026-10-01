"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CoverArt } from "./PublicChrome";
import styles from "@/app/revista/magazine.module.css";

export type StoryGalleryImage = { src: string; alt: string; caption: string };

export function StoryGallery({ images }: { images: StoryGalleryImage[] }) {
  const titleId = useId();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<number | null>(null);
  const currentIndex = images.length ? index % images.length : 0;
  const current = images[currentIndex];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!playing || paused || reducedMotion || images.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setIndex((previous) => (previous + 1) % images.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [playing, paused, reducedMotion, images.length]);

  function move(direction: number) {
    setPlaying(false);
    setIndex((previous) => (previous + direction + images.length) % images.length);
  }

  if (!current) return null;

  return (
    <section className={styles.articleGallery} aria-labelledby={titleId} aria-roledescription="carrusel"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      <div className={styles.galleryHeading}>
        <h2 id={titleId}>La historia en imágenes</h2>
        <span>{currentIndex + 1} / {images.length}</span>
      </div>
      <div className={styles.galleryViewport} tabIndex={images.length > 1 ? 0 : undefined}
        aria-label="Fotografías de la publicación"
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); } }}
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const end = event.changedTouches[0]?.clientX;
          if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 45) move(end < touchStart.current ? 1 : -1);
          touchStart.current = null;
        }}>
        <figure key={`${current.src}-${currentIndex}`} className={styles.galleryFigure} role="group" aria-roledescription="diapositiva" aria-label={`${currentIndex + 1} de ${images.length}`}>
          <CoverArt src={current.src} alt={current.alt} className={styles.galleryCover} />
          {current.caption ? <figcaption>{current.caption}</figcaption> : null}
        </figure>
        {images.length > 1 ? <div className={styles.galleryArrows}>
          <button type="button" onClick={() => move(-1)} aria-label="Fotografía anterior">←</button>
          <button type="button" onClick={() => move(1)} aria-label="Fotografía siguiente">→</button>
        </div> : null}
      </div>
      {images.length > 1 ? <div className={styles.galleryControls}>
        <div className={styles.galleryDots} aria-label="Elegir fotografía">
          {images.map((image, imageIndex) => <button key={image.src} type="button" aria-label={`Ver fotografía ${imageIndex + 1}: ${image.alt}`} aria-pressed={currentIndex === imageIndex}
            onClick={() => { setPlaying(false); setIndex(imageIndex); }}><span /></button>)}
        </div>
        {!reducedMotion ? <button className={styles.galleryPlay} type="button" onClick={() => setPlaying((previous) => !previous)}>{playing ? "Pausar carrusel" : "Reproducir carrusel"}</button> : null}
      </div> : null}
    </section>
  );
}
