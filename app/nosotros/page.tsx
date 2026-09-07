import type { Metadata } from "next";

import {
  ArrowLink,
  ArrowUpRight,
  PublicShell,
  SectionLabel,
} from "@/components/public/PublicChrome";

import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "Nosotros",
  description:
    "La historia del Club Rotario Santo Domingo Colonial, su relación con Rotary International y su manera de organizar el servicio.",
};

const rotaryTimeline = [
  {
    year: "1905",
    title: "El primer club en Chicago",
    body: "El 23 de febrero, Paul P. Harris reunió a Gustavus Loehr, Silvester Schiele y Hiram Shorey para formar un club de profesionales con vocaciones diversas.",
  },
  {
    year: "1910",
    title: "Los clubes se organizan",
    body: "Representantes de 16 clubes se reunieron en Chicago y crearon la asociación nacional que precedió a Rotary International. Los clubes conservaron su autonomía y compartieron valores.",
  },
  {
    year: "1911",
    title: "Una revista para conectar",
    body: "Rotary publicó el primer número de The Rotarian para compartir mensajes, noticias y aprendizajes entre sus clubes y miembros.",
  },
  {
    year: "1979",
    title: "La acción toma escala",
    body: "Rotary inició en Filipinas un proyecto para inmunizar a seis millones de niños contra la polio, un antecedente de su compromiso global con la erradicación de la enfermedad.",
  },
];

const clubTimeline = [
  {
    year: "1969",
    title: "Nace el club en Santo Domingo",
    body: "La reseña histórica de Rotary en el Corazón de las Américas atribuye la fundación del Club Rotario Santo Domingo Colonial a Leonidas Heyaime Valenzuela durante su gobernación distrital.",
    source: "Rotary en el Corazón de las Américas",
    href: "https://rotaryca.org/publicaciones/personajes-inolvidables-leonidas-heyaime-valenzuela-pdg-1968-196/",
  },
  {
    year: "2019",
    title: "Cincuenta años de servicio",
    body: "El Instituto Postal Dominicano conmemoró el 50 aniversario del club y reconoció sus aportes a la sociedad dominicana con una emisión postal especial.",
    source: "INPOSDOM",
    href: "https://inposdom.gob.do/filatelia/el-inposdom-celebra-el-50-aniversario-del-club-rotario-santo-domingo-colonial-con-la-emision-de-una-nueva-serie-postal/",
  },
  {
    year: "2022",
    title: "Servicio que llega a la comunidad",
    body: "El Hospital Regional Taiwán documentó la apertura de una sala de lactancia materna realizada junto al Club Rotario Santo Domingo Colonial.",
    source: "Hospital Regional Taiwán",
    href: "https://hospitaltaiwan.gob.do/general/aperturan-sala-de-lactancia-materna-en-el-hospital-regional-taiwan/",
  },
  {
    year: "2026",
    title: "Una historia que sigue creciendo",
    body: "La celebración del 57 aniversario incluyó la juramentación de nuevos socios y renovó el compromiso del club con el servicio, la amistad y la comunidad.",
    source: "El Pregonero",
    href: "https://elpregonerord.com/rotary-club-santo-domingo-colonial-celebra-dia-de-las-madres-y-juramenta-nuevos-socios/",
  },
];

const rotaryParts = [
  {
    number: "01",
    eyebrow: "Raíz local",
    title: "El club",
    body: "El Club Rotario Santo Domingo Colonial es el espacio donde personas de Santo Domingo se reúnen, construyen relaciones y convierten necesidades locales en servicio.",
  },
  {
    number: "02",
    eyebrow: "Red global",
    title: "Rotary International",
    body: "La organización que apoya y coordina proyectos, campañas e iniciativas para conectar a los clubes rotarios en todo el mundo.",
  },
  {
    number: "03",
    eyebrow: "Alcance",
    title: "La Fundación Rotaria",
    body: "La entidad que proporciona fondos para actividades humanitarias, desde proyectos comunitarios hasta iniciativas de alcance internacional.",
  },
];

const focusAreas = [
  "Promover la paz",
  "Combatir enfermedades",
  "Agua, saneamiento e higiene",
  "Salud materno-infantil",
  "Educación y alfabetización",
  "Desarrollo económico de las comunidades",
  "Protección del medioambiente",
];

const clubStructure = [
  {
    number: "01",
    title: "Directiva anual",
    body: "La presidencia, secretaría, tesorería y demás cargos organizan cada periodo rotario. Los nombres de la directiva vigente se publicarán cuando sean confirmados por el club.",
  },
  {
    number: "02",
    title: "Comités y proyectos",
    body: "Los comités convierten las prioridades en propuestas, alianzas y actividades con responsables, fechas y resultados que pueden documentarse.",
  },
  {
    number: "03",
    title: "Distrito 4060 y aliados",
    body: "El club se conecta con el Distrito 4060, Rotary International, otros clubes y aliados locales para ampliar el alcance de su servicio.",
  },
];

const sources = [
  {
    label: "Rotary International · Historia",
    body: "Origen, cronología fundacional y evolución del movimiento rotario.",
    href: "https://www.rotary.org/es-mx/who-we-are/our-history",
  },
  {
    label: "Rotary International · Estructura",
    body: "Los tres pilares que conectan clubes, Rotary International y La Fundación Rotaria.",
    href: "https://www.rotary.org/es-mx/who-we-are/our-structure",
  },
  {
    label: "Rotary en el Corazón de las Américas",
    body: "Referencia pública sobre Leonidas Heyaime Valenzuela y la fundación del club en 1969.",
    href: "https://rotaryca.org/publicaciones/personajes-inolvidables-leonidas-heyaime-valenzuela-pdg-1968-196/",
  },
  {
    label: "INPOSDOM · 50 aniversario",
    body: "Registro institucional de la conmemoración del club en 2019.",
    href: "https://inposdom.gob.do/filatelia/el-inposdom-celebra-el-50-aniversario-del-club-rotario-santo-domingo-colonial-con-la-emision-de-una-nueva-serie-postal/",
  },
];

export default function NosotrosPage() {
  return (
    <PublicShell active="nosotros">
      <main className={styles.main}>
        <section className={styles.aboutBanner} aria-labelledby="about-title">
          <div className={styles.aboutBannerContent}>
            <div className={styles.aboutBannerTop}>
              <SectionLabel>El club · Historia y relación</SectionLabel>
              <span className={styles.aboutBannerDate}>1969 — HOY</span>
            </div>
            <h1 id="about-title">Una raíz local. <em>Una red mundial.</em></h1>
            <p>Conoce la historia del Club Rotario Santo Domingo Colonial, su lugar dentro de Rotary International y la estructura que convierte los vínculos en servicio.</p>
          </div>
          <div className={styles.aboutBannerFoot}>
            <span>Fundado en 1969 · Santo Domingo</span>
            <span>Rotary International · Distrito 4060</span>
            <span>Historia y estructura</span>
          </div>
        </section>

        <section className={styles.relationship} id="relacion">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>La relación</SectionLabel><h2>Un club local dentro de <span>una red mundial.</span></h2></div>
            <p>Rotary se organiza en tres pilares que trabajan juntos para lograr un cambio duradero.</p>
          </div>
          <div className={styles.relationshipGrid}>
            {rotaryParts.map((part) => (
              <article className={styles.relationshipCard} key={part.number}>
                <span>{part.number}</span>
                <small>{part.eyebrow}</small>
                <h3>{part.title}</h3>
                <p>{part.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.clubHistory} id="historia-club">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Historia local</SectionLabel><h2>Una memoria que merece <span>quedar documentada.</span></h2></div>
            <p>Hechos públicos sobre el Club Rotario Santo Domingo Colonial, reunidos para orientar la memoria institucional.</p>
          </div>
          <div className={styles.historyLead}>
            <p>El Club Rotario Santo Domingo Colonial nació en 1969 y desde entonces forma parte de la conversación rotaria en la República Dominicana: personas que se reúnen, se reconocen y se organizan para servir.</p>
            <p>Esta línea de tiempo reúne referencias públicas. La plataforma permitirá sumar actas, fotografías, presidentes y proyectos cuando el club los entregue y valide.</p>
          </div>
          <div className={`${styles.timeline} ${styles.localTimeline}`}>
            {clubTimeline.map((item) => (
              <div className={styles.timelineItem} key={item.year}>
                <span className={styles.timelineYear}>{item.year}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p><a className={styles.timelineSource} href={item.href} target="_blank" rel="noreferrer">{item.source} <ArrowUpRight /></a></div>
              </div>
            ))}
          </div>
          <a className={styles.sourceLink} href="https://rotaryca.org/publicaciones/personajes-inolvidables-leonidas-heyaime-valenzuela-pdg-1968-196/" target="_blank" rel="noreferrer">Ver la referencia histórica del club <ArrowUpRight /></a>
        </section>

        <section className={styles.history} id="rotary-international">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Rotary International</SectionLabel><h2>La red que empezó con <span>una conversación.</span></h2></div>
            <p>Una cronología editorial basada en las fuentes oficiales de Rotary International.</p>
          </div>
          <div className={styles.historyLead}>
            <p>Rotary nació el 23 de febrero de 1905 en Chicago, cuando Paul P. Harris reunió a personas de distintas profesiones para compartir ideas, crear amistades y servir.</p>
            <p>El movimiento internacional ofrece el marco que conecta al club local con otros clubes, programas y comunidades alrededor del mundo.</p>
          </div>
          <div className={styles.timeline}>
            {rotaryTimeline.map((item) => (
              <div className={styles.timelineItem} key={item.year}>
                <span className={styles.timelineYear}>{item.year}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
              </div>
            ))}
          </div>
          <a className={styles.sourceLink} href="https://www.rotary.org/es-mx/who-we-are/our-history" target="_blank" rel="noreferrer">Ver la historia completa en Rotary International <ArrowUpRight /></a>
        </section>

        <section className={styles.structure} id="estructura">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Cómo se articula</SectionLabel><h2>Tres piezas. <span>Un mismo propósito.</span></h2></div>
            <p>La estructura oficial explica cómo una idea local puede encontrar apoyo y alcance internacional.</p>
          </div>
          <div className={styles.partsGrid}>
            {rotaryParts.map((part) => (
              <article className={styles.partCard} key={part.number}>
                <span>{part.number}</span><small className={styles.partEyebrow}>{part.eyebrow}</small><h3>{part.title}</h3><p>{part.body}</p>
              </article>
            ))}
          </div>
          <a className={styles.sourceLink} href="https://www.rotary.org/es-mx/who-we-are/our-structure" target="_blank" rel="noreferrer">Consultar la estructura oficial <ArrowUpRight /></a>
        </section>

        <section className={styles.club} id="estructura-club">
          <div className={styles.clubIntro}>
            <SectionLabel>El club por dentro</SectionLabel>
            <h2>La organización convierte la intención en <em>acción.</em></h2>
            <p>La estructura del Club Rotario Santo Domingo Colonial se presenta aquí de forma clara para que la directiva pueda completarla con sus nombres, periodos y responsabilidades.</p>
            <p className={styles.notice}>Los cargos y el directorio vigente se publicarán únicamente después de ser confirmados por la organización.</p>
            <a className={styles.buttonLight} href="mailto:club@rotariosantodomingo.org?subject=Información%20institucional%20del%20club">Compartir información del club <ArrowUpRight /></a>
          </div>
          <div className={styles.clubStructure}>
            <div className={styles.clubStructureHead}><span>Estructura pública</span><span>01 — 03</span></div>
            {clubStructure.map((item) => (
              <article key={item.number}>
                <span>{item.number}</span><div><h3>{item.title}</h3><p>{item.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.focus}>
          <div><SectionLabel>Áreas de interés</SectionLabel><h2>El marco para <em>actuar con propósito.</em></h2><p>Rotary usa estas siete áreas para enfocar esfuerzos. La prioridad concreta de cada proyecto nace de escuchar la realidad local.</p></div>
          <div className={styles.focusList}>{focusAreas.map((area, index) => <span key={area}><strong>{String(index + 1).padStart(2, "0")}</strong>{area}</span>)}</div>
        </section>
        <a className={styles.sourceLink} href="https://www.rotary.org/es-mx/our-causes" target="_blank" rel="noreferrer">Conocer las áreas de interés en Rotary International <ArrowUpRight /></a>

        <section className={styles.sources} id="fuentes">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Fuentes consultadas</SectionLabel><h2>Una historia con <span>referencias.</span></h2></div>
            <p>Enlaces públicos para ampliar cada capítulo y mantener la memoria institucional verificable.</p>
          </div>
          <div className={styles.sourceGrid}>
            {sources.map((source, index) => (
              <a className={styles.sourceCard} href={source.href} key={source.href} target="_blank" rel="noreferrer">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{source.label}</strong>
                <p>{source.body}</p>
                <ArrowUpRight />
              </a>
            ))}
          </div>
          <p className={styles.sourceDisclaimer}>La historia local seguirá creciendo con testimonios, documentos y fotografías que el club revise y autorice para publicación.</p>
        </section>

        <section className={styles.joinBand}>
          <div><SectionLabel>Ser parte</SectionLabel><h2>El servicio también necesita nuevas preguntas.</h2></div>
          <ArrowLink href="/auth/sign-up?next=/plataforma">Quiero conocer el club</ArrowLink>
        </section>
      </main>
    </PublicShell>
  );
}
