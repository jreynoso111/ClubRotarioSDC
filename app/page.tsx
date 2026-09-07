import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { PublicHeader } from "@/components/public/PublicChrome";
import StoriesCarousel from "@/components/public/StoriesCarousel";
import { getPublicFeed } from "@/lib/supabase/public-feed";

const heroIllustrations = [
  {
    src: "/alcazar-colon-illustration.png",
    alt: "Ilustración editorial del Alcázar de Colón frente a la Plaza de España en Santo Domingo",
  },
  {
    src: "/zona-colonial-illustration.png",
    alt: "Ilustración editorial de una calle empedrada de la Ciudad Colonial de Santo Domingo",
  },
  {
    src: "/zona-colonial-dusk.png",
    alt: "Ilustración editorial de las murallas de la Ciudad Colonial al anochecer",
  },
  {
    src: "/zona-colonial-courtyard.png",
    alt: "Ilustración editorial de un patio colonial con arcos y fuente en Santo Domingo",
  },
  {
    src: "/zona-colonial-las-damas.png",
    alt: "Ilustración editorial de la calle Las Damas en la Ciudad Colonial de Santo Domingo",
  },
  {
    src: "/zona-colonial-fortaleza.png",
    alt: "Ilustración editorial de la Fortaleza Ozama junto al río en Santo Domingo",
  },
  {
    src: "/zona-colonial-illustration.png",
    alt: "",
  },
];

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="icon icon-arrow">
      <path d="M3 13 13 3M5 3h8v8" />
    </svg>
  );
}

function ClubSignature({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "club-signature club-signature-compact" : "club-signature"}>
      <Image
        src="/club-santo-domingo-colonial-logo.png"
        alt="Rotary Club Santo Domingo Colonial"
        width={1401}
        height={310}
        priority={compact}
      />
    </span>
  );
}

function CinematicIntro() {
  return (
    <div className="cinematic-intro" aria-hidden="true">
      <div className="cinematic-intro-curtain cinematic-intro-curtain-left" />
      <div className="cinematic-intro-curtain cinematic-intro-curtain-right" />
      <div className="cinematic-intro-line" />
      <div className="cinematic-intro-content">
        <div className="cinematic-intro-logo-wrap">
          <Image src="/club-santo-domingo-colonial-logo.png" alt="Rotary Club Santo Domingo Colonial" width={1401} height={310} priority />
        </div>
        <span className="cinematic-intro-caption">Personas de acción · Revista social</span>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="section-label">
      <span className="section-label-line" />
      {children}
    </p>
  );
}

function DateBadge({ date, tone }: { date: string; tone: string }) {
  const [day, month] = date.split(" ");

  return (
    <span className={["event-date", "event-date-" + tone].join(" ")}>
      <strong>{day}</strong>
      <small>{month}</small>
    </span>
  );
}

export default async function Home() {
  const { events, stories } = await getPublicFeed();
  const agendaClassName = events.length < 3
    ? "agenda-section agenda-section-compact section-shell"
    : "agenda-section section-shell";

  return (
    <main>
      <CinematicIntro />

      <PublicHeader active="home" />

      <section className="hero section-shell" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-pulse" />
            Revista social · Club Rotario Santo Domingo Colonial
          </p>
          <h1>Servir también es <em>contar lo que hacemos.</em></h1>
          <p className="hero-lede">
            Historias, encuentros y memoria para mirar de cerca una comunidad que
            encuentra en el servicio una forma de estar presente.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/auth/sign-up">
              Quiero ser miembro <ArrowUpRight />
            </Link>
          </div>
          <div className="hero-meta" aria-label="Secciones de la revista">
            <span>Historias / Agenda / Memoria</span>
            <span>Ciudad Colonial · Santo Domingo</span>
          </div>
        </div>

        <figure className="hero-art">
          {heroIllustrations.map((illustration, index) => (
            <Image
              key={illustration.src + "-" + index}
              src={illustration.src}
              alt={index === 0 ? illustration.alt : ""}
              aria-hidden={index === 0 ? undefined : true}
              className={"hero-art-image hero-art-image-" + index}
              fill
              loading="eager"
              priority={index === 0}
              sizes="(max-width: 760px) 100vw, 50vw"
            />
          ))}
          <div className="hero-photo-wash" />
          <div className="hero-photo-sweep" />
          <div className="hero-photo-frame" />
          <div className="hero-art-topline"><span>SDQ / ZC</span><span>Servicio en movimiento</span></div>
          <div className="hero-photo-caption"><span>01</span><span>Una ciudad que se cuida<br />desde sus vínculos.</span></div>
          <div className="hero-photo-index">REVISTA<br /><span>—</span><br />EN CURSO</div>
          <div className="hero-photo-label">JUNTOS<br />SERVIMOS</div>
          <figcaption>Ciudad Colonial de Santo Domingo · ilustración editorial</figcaption>
        </figure>
      </section>

      <section className="signal-strip" aria-label="Temas de la revista">
        <span>Personas de acción</span><i aria-hidden="true" />
        <span>Compañerismo</span><i aria-hidden="true" />
        <span>Integridad</span><i aria-hidden="true" />
        <span>Diversidad</span><i aria-hidden="true" />
        <span>Servicio</span><i aria-hidden="true" />
        <span>Liderazgo</span><i aria-hidden="true" />
        <span>Comunidad</span><i aria-hidden="true" />
        <span>Colaboración</span><i aria-hidden="true" />
        <span>Compromiso</span><i aria-hidden="true" />
        <span>Cuidado</span><i aria-hidden="true" />
        <span>Memoria</span><i aria-hidden="true" />
        <span>Futuro</span>
      </section>

      <section className="stories-section section-shell" id="historias">
        <div className="section-heading-row">
          <div>
            <SectionLabel>Crónicas del servicio</SectionLabel>
            <h2>Leer para <span>conectar.</span></h2>
          </div>
          <div className="heading-aside">
            <p>La memoria del club se construye con voces, aprendizajes y escenas compartidas.</p>
            <Link className="text-link text-link-dark" href="/revista">
              Abrir la revista <ArrowUpRight />
            </Link>
          </div>
        </div>

        {stories.length > 0 ? (
          <StoriesCarousel stories={stories} />
        ) : (
          <div className="empty-feed empty-feed-stories">
            <span className="empty-feed-mark">Revista</span>
            <p>Las próximas historias del club aparecerán aquí.</p>
            <Link className="text-link text-link-dark" href="/revista">Visitar la revista <ArrowUpRight /></Link>
          </div>
        )}
      </section>

      <section className={agendaClassName} id="agenda">
        <div className="section-heading-row">
          <div>
            <SectionLabel>Agenda pública</SectionLabel>
            <h2>Lo que está <span>pasando.</span></h2>
          </div>
          <div className="heading-aside">
            <p>Encuentros para acercarse, participar y seguir el pulso del club.</p>
            <Link className="text-link text-link-dark" href="/eventos">
              Ver todos los eventos <ArrowUpRight />
            </Link>
          </div>
        </div>

        {events.length > 0 ? (
          <div className="events-list">
            {events.map((event) => (
              <Link className="event-row" href={event.href} key={event.title}>
                <DateBadge date={event.date} tone={event.tone} />
                <span className="event-main">
                  <small>{event.kind} · {event.time}</small>
                  <strong>{event.title}</strong>
                  <span>{event.detail}</span>
                </span>
                <span className="event-arrow"><ArrowUpRight /></span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-feed">
            <span className="empty-feed-mark">Agenda</span>
            <p>La agenda pública se está preparando. Vuelve pronto para encontrar el próximo encuentro.</p>
            <Link className="text-link text-link-dark" href="/eventos">Explorar eventos <ArrowUpRight /></Link>
          </div>
        )}
      </section>

      <section className="join-section section-shell" id="unete">
        <div className="join-panel">
          <div className="join-copy">
            <SectionLabel>Una invitación abierta</SectionLabel>
            <h2>Tu experiencia puede convertirse en <em>servicio.</em></h2>
            <p>
              Si te mueve tu comunidad, hay una conversación que podemos
              comenzar. Conoce el club y encuentra tu manera de participar.
            </p>
            <div className="join-actions">
              <Link className="text-link text-link-dark" href="/nosotros">
                Conocer el club <ArrowUpRight />
              </Link>
            </div>
          </div>
          <div className="join-note">
            <span>CLUB ROTARIO<br /><strong>SANTO DOMINGO COLONIAL</strong></span>
            <p>Personas de acción, reunidas para servir con propósito.</p>
          </div>
        </div>
      </section>

      <section className="club-section" id="club">
        <div className="club-section-inner section-shell">
          <div className="club-masthead">
            <span className="club-stamp">ROTARY<br /><strong>SDQ COLONIAL</strong></span>
            <span className="club-index">EL CLUB<br /><b>—</b><br />POR DENTRO</span>
          </div>
          <div className="club-copy">
            <SectionLabel>El club por dentro</SectionLabel>
            <h2>La historia también <em>se organiza.</em></h2>
            <p>
              Conoce las raíces de Rotary International, la historia del Club
              Rotario Santo Domingo Colonial y la estructura que sostiene el
              trabajo compartido.
            </p>
            <div className="club-path">
              <Link className="club-path-link" href="/nosotros">
                <span><strong>Historia, principios y estructura</strong><small>Una guía para entender cómo se organiza el servicio.</small></span>
                <ArrowUpRight />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer section-shell">
        <div className="footer-brand">
          <ClubSignature />
          <p>
            Servicio local.<br />Vínculos que permanecen.
            <small>Todos los derechos reservados · © {new Date().getFullYear()} Club Rotario Santo Domingo Colonial</small>
          </p>
        </div>
        <div className="footer-links" aria-label="Enlaces del sitio">
          <nav className="footer-link-group" aria-label="Explorar">
            <small>Explorar</small>
            <Link href="/revista">Revista</Link>
            <Link href="/eventos">Agenda</Link>
            <Link href="/nosotros">El club</Link>
          </nav>
          <nav className="footer-link-group" aria-label="Miembros">
            <small>Miembros</small>
            <Link href="/auth/sign-in?next=/plataforma">Acceder</Link>
            <Link href="/auth/sign-up">Ser miembro</Link>
          </nav>
        </div>
        <a className="footer-arrow" href="#inicio" aria-label="Volver al inicio"><ArrowUpRight /></a>
      </footer>
    </main>
  );
}
