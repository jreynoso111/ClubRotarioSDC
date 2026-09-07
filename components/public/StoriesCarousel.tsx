"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowUpRight } from "@/components/public/PublicChrome";

type Story = {
  href: string;
  index: string;
  type: string;
  title: string;
  excerpt: string;
  color: string;
  image?: string;
  imageAlt?: string;
};

const AUTOPLAY_MS = 6500;

function getCarouselStep(viewport: HTMLDivElement) {
  const firstCard = viewport.querySelector<HTMLElement>("[data-story-card]");
  if (!firstCard) return 0;

  const track = firstCard.parentElement;
  const gap = track ? Number.parseFloat(window.getComputedStyle(track).gap) || 0 : 0;
  return firstCard.getBoundingClientRect().width + gap;
}

export default function StoriesCarousel({ stories }: { stories: Story[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const syncCarousel = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    setIsScrollable(viewport.scrollWidth > viewport.clientWidth + 2);

    const cards = Array.from(viewport.querySelectorAll<HTMLElement>("[data-story-card]"));
    if (cards.length === 0) return;

    const nearestIndex = cards.reduce(
      (nearest, card, index) => {
        const distance = Math.abs(card.offsetLeft - viewport.scrollLeft);
        return distance < nearest.distance ? { distance, index } : nearest;
      },
      { distance: Number.POSITIVE_INFINITY, index: 0 },
    ).index;

    setActiveIndex(nearestIndex);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    syncCarousel();
    viewport.addEventListener("scroll", syncCarousel, { passive: true });

    const resizeObserver = new ResizeObserver(syncCarousel);
    resizeObserver.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", syncCarousel);
      resizeObserver.disconnect();
    };
  }, [syncCarousel]);

  const move = useCallback((direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const step = getCarouselStep(viewport);
    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (step === 0 || maxScroll <= 2) return;

    const atStart = viewport.scrollLeft <= 2;
    const atEnd = viewport.scrollLeft >= maxScroll - 2;
    const target = direction > 0
      ? atEnd ? 0 : Math.min(viewport.scrollLeft + step, maxScroll)
      : atStart ? maxScroll : Math.max(viewport.scrollLeft - step, 0);

    viewport.scrollTo({ left: target, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!isScrollable || stories.length < 2 || isPaused) return;

    const timer = window.setInterval(() => move(1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [isPaused, isScrollable, move, stories.length]);

  return (
    <div
      className="stories-carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <div
        className="stories-carousel-viewport"
        ref={viewportRef}
        role="region"
        aria-label="Crónicas del servicio"
        tabIndex={0}
      >
        <div className="stories-grid">
          {stories.map((story) => (
            <article className="story-card" data-story-card key={story.index}>
              <Link className="story-card-link" href={story.href}>
                <div className={"story-visual " + story.color}>
                  <span className="story-visual-index">{story.index}</span>
                  {story.image ? (
                    <Image
                      src={story.image}
                      alt={story.imageAlt ?? ""}
                      fill
                      sizes="(max-width: 760px) 100vw, (max-width: 900px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="story-visual-shape" />
                  )}
                  <span className="story-visual-overlay" />
                  <span className="story-visual-word">ROTARY<br />SDQ</span>
                </div>
                <div className="story-content">
                  <small>{story.type}</small>
                  <h3>{story.title}</h3>
                  <p>{story.excerpt}</p>
                  <span className="story-link">Leer historia <ArrowUpRight /></span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </div>

      {stories.length > 1 && (
        <div className="stories-carousel-nav" aria-label="Navegación de crónicas">
          <span className="stories-carousel-status" aria-live="polite">
            {String(activeIndex + 1).padStart(2, "0")} <b>/</b> {String(stories.length).padStart(2, "0")}
          </span>
          <div className="stories-carousel-buttons">
            <button
              type="button"
              className="stories-carousel-button"
              aria-label="Historia anterior"
              onClick={() => move(-1)}
              disabled={!isScrollable}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              className="stories-carousel-button"
              aria-label="Historia siguiente"
              onClick={() => move(1)}
              disabled={!isScrollable}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
