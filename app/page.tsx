import type { ReactNode } from "react";

const events = [
  {
    date: "18 SEP",
    time: "7:00 PM",
    title: "Noche de ideas",
    detail: "Casa de Teatro · Ubicación por confirmar",
    kind: "Encuentro",
    tone: "lime",
  },
  {
    date: "27 SEP",
    time: "8:30 AM",
    title: "Ciudad que cuida",
    detail: "Zona Colonial · Lugar por confirmar",
    kind: "Servicio",
    tone: "sun",
  },
  {
    date: "04 OCT",
    time: "6:30 PM",
    title: "Mesa de propuestas",
    detail: "Virtual · Sala de miembros",
    kind: "Plataforma",
    tone: "coral",
  },
];

const stories = [
  {
    index: "01",
    type: "CRÓNICA",
    title: "Una ciudad se transforma cuando sus personas se encuentran",
    excerpt:
      "La jornada de abril convirtió una calle de la Zona Colonial en una conversación abierta sobre cuidado, memoria y futuro.",
    color: "story-yellow",
  },
  {
    index: "02",
    type: "VOCES DEL CLUB",
    title: "El servicio también se diseña",
    excerpt:
      "Tres miembros comparten cómo una buena pregunta puede convertirse en una actividad que mueve a toda la comunidad.",
    color: "story-coral",
  },
  {
    index: "03",
    type: "ARCHIVO",
    title: "La memoria de servir, año tras año",
    excerpt:
      "Un recorrido por las historias que han mantenido viva la vocación del club desde la Ciudad Colonial.",
    color: "story-teal",
  },
];

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="icon icon-arrow">
      <path d="M3 13 13 3M5 3h8v8" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="icon">
      <path d="M8 2v11M3.5 8.5 8 13l4.5-4.5" />
    </svg>
  );
}

function RotaryMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "rotary-mark rotary-mark-compact" : "rotary-mark"} aria-hidden="true">
      <span className="rotary-mark-center" />
      {Array.from({ length: 8 }).map((_, index) => (
        <span
          className="rotary-mark-dot"
          key={index}
          style={{ transform: `rotate(${index * 45}deg) translateY(-14px)` }}
        />
      ))}
    </span>
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

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label="Club Rotario Santo Domingo Colonial, inicio">
          <RotaryMark compact />
          <span className="brand-copy">
            <strong>ROTARY</strong>
            <span>Santo Domingo<br />Colonial</span>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Navegación principal">
          <a href="#agenda">Agenda</a>
          <a href="#memoria">Historias</a>
          <a href="#club">El club</a>
        </nav>

        <a className="header-cta" href="#acceso">
          Entrar a la plataforma <ArrowUpRight />
        </a>
        <details className="mobile-menu">
          <summary aria-label="Abrir menú"><span /><span /></summary>
          <nav aria-label="Navegación móvil">
            <a href="#agenda">Agenda</a>
            <a href="#memoria">Historias</a>
            <a href="#club">El club</a>
            <a href="#acceso">Entrar</a>
          </nav>
        </details>
      </header>

      <section className="hero section-shell" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-pulse" /> Club Rotario · Distrito 4060</p>
          <h1>Hacer que la ciudad se mueva <em>en la misma dirección.</em></h1>
          <p className="hero-lede">
            Abrimos espacios para que personas, conocimiento y tiempo se conviertan en servicio para Santo Domingo Colonial.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#agenda">Ver próximos encuentros <ArrowDown /></a>
            <a className="text-link" href="#club">Conocer nuestra forma de servir <ArrowUpRight /></a>
          </div>
          <div className="hero-footnote"><span>01</span><span className="hero-footnote-rule" /><span>Personas antes que protocolos</span></div>
        </div>

        <div className="hero-art" role="img" aria-label="Composición abstracta inspirada en la ciudad, el encuentro y el movimiento">
          <div className="hero-art-topline"><span>SDQ / ZC</span><span>Año en curso</span></div>
          <svg className="territory-trace" viewBox="0 0 540 440" aria-hidden="true">
            <path className="trace-river" d="M-40 365 C80 306 119 405 213 342 S364 261 580 305" />
            <path className="trace-wall" d="M32 60 186 30 278 76 405 47 512 91 489 196 525 269 454 349 319 378 205 347 105 378 41 310 67 210Z" />
            <path className="trace-grid" d="M58 113 468 109M47 164 492 160M52 216 485 213M78 266 464 270M112 313 423 319M107 72 116 348M177 54 184 351M248 61 252 367M326 60 318 363M397 64 390 350M460 84 446 330" />
            <circle className="trace-point trace-point-one" cx="184" cy="164" r="7" />
            <circle className="trace-point trace-point-two" cx="318" cy="265" r="7" />
            <circle className="trace-point trace-point-three" cx="390" cy="112" r="7" />
          </svg>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="hero-art-core"><RotaryMark /><span>servicio<br />en movimiento</span></div>
          <div className="hero-note hero-note-top"><span className="note-number">A</span><span>Una ciudad<br />más atenta</span></div>
          <div className="hero-note hero-note-bottom"><span className="note-number">B</span><span>Una mesa<br />para todos</span></div>
          <div className="hero-art-index">2026<br /><span>—</span><br />EN CURSO</div>
          <div className="hero-art-legend"><span className="legend-dot" /> Trazo urbano <i /> puntos de encuentro</div>
          <div className="hero-art-label">MOVER<br />JUNTOS</div>
        </div>
      </section>

      <section className="signal-strip" aria-label="Valores del club">
        <span>Personas</span><i />
        <span>Ideas</span><i />
        <span>Servicio</span><i />
        <span>Ciudad</span><i />
        <span>Personas</span><i />
        <span>Ideas</span><i />
        <span>Servicio</span>
      </section>

      <section className="agenda-section section-shell" id="agenda">
        <div className="section-heading-row">
          <div>
            <SectionLabel>La agenda viva</SectionLabel>
            <h2>Lo que está <span>pasando.</span></h2>
          </div>
          <a className="text-link text-link-dark" href="#agenda">Ver calendario completo <ArrowUpRight /></a>
        </div>
        <div className="events-list">
          {events.map((event) => (
            <a className="event-row" href="#acceso" key={event.title}>
              <span className={`event-date event-date-${event.tone}`}><strong>{event.date.split(" ")[0]}</strong><small>{event.date.split(" ")[1]}</small></span>
              <span className="event-main"><small>{event.kind} · {event.time}</small><strong>{event.title}</strong><span>{event.detail}</span></span>
              <span className="event-arrow"><ArrowUpRight /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="manifesto-section section-shell" id="club">
        <div className="manifesto-mark"><RotaryMark /><span>01 — 03</span></div>
        <div className="manifesto-copy">
          <SectionLabel>Nuestra manera</SectionLabel>
          <h2>No venimos a llenar una agenda. <em>Venimos a abrir posibilidades.</em></h2>
          <p>El club es una mesa donde una inquietud puede encontrar aliados, estructura y el impulso necesario para convertirse en servicio.</p>
          <div className="manifesto-stats"><span><strong>01</strong> Comunidad</span><span><strong>02</strong> Acción</span><span><strong>03</strong> Legado</span></div>
        </div>
      </section>

      <section className="stories-section section-shell" id="memoria">
        <div className="section-heading-row">
          <div>
            <SectionLabel>Bitácora del club</SectionLabel>
            <h2>Historias que <span>quedan.</span></h2>
          </div>
          <a className="text-link text-link-dark" href="#memoria">Explorar el blog <ArrowUpRight /></a>
        </div>
        <div className="stories-grid">
          {stories.map((story, index) => (
            <article className={`story-card ${index === 0 ? "story-card-featured" : ""}`} key={story.index}>
              <div className={`story-visual ${story.color}`}><span>{story.index}</span><div className="story-visual-shape" /><span className="story-visual-word">ROTARY<br />SDQ</span></div>
              <div className="story-content"><small>{story.type}</small><h3>{story.title}</h3><p>{story.excerpt}</p><a className="story-link" href="#acceso">Leer historia <ArrowUpRight /></a></div>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section section-shell" id="acceso">
        <div className="platform-card">
          <div className="platform-intro"><SectionLabel>Para quienes hacen que suceda</SectionLabel><h2>La parte del club que <em>no se ve desde la calle.</em></h2><p>Organiza actividades, presenta propuestas y participa en las decisiones desde un mismo lugar.</p><a className="button button-light" href="mailto:club@rotariosantodomingo.org">Solicitar acceso <ArrowUpRight /></a></div>
          <div className="platform-rail"><div className="platform-rail-head"><span>Dentro de la plataforma</span><span>→</span></div><div className="platform-feature"><strong>01</strong><span>Propuestas</span><small>De la idea al plan</small></div><div className="platform-feature"><strong>02</strong><span>Actividades</span><small>Rifas, sorteos y encuentros</small></div><div className="platform-feature"><strong>03</strong><span>Organización</span><small>Comités, tareas y responsables</small></div></div>
        </div>
      </section>

      <footer className="site-footer section-shell"><div className="footer-brand"><RotaryMark compact /><strong>ROTARY<br />SANTO DOMINGO<br />COLONIAL</strong></div><div className="footer-copy"><p>Una comunidad para servir mejor, juntos.</p><small>© {new Date().getFullYear()} Club Rotario Santo Domingo Colonial</small></div><a className="footer-arrow" href="#inicio" aria-label="Volver al inicio"><ArrowUpRight /></a></footer>
    </main>
  );
}
