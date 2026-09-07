import type { Metadata } from "next";
import Link from "next/link";

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
    "La historia de Rotary International y la estructura pública en construcción del Club Rotario Santo Domingo Colonial.",
};

const timeline = [
  {
    year: "1905",
    title: "Una primera conversación",
    body: "Paul P. Harris reúne en Chicago a Gustavus Loehr, Silvester Schiele y Hiram Shorey para formar un club de profesionales con vocaciones diversas.",
  },
  {
    year: "1910",
    title: "La idea cruza la ciudad",
    body: "Los 16 clubes existentes se unen en la National Association of Rotary Clubs, la organización que hoy conocemos como Rotary International.",
  },
  {
    year: "1911",
    title: "Una revista para conectar clubes",
    body: "Rotary publica el primer número de The Rotarian para compartir mensajes, noticias y aprendizajes entre sus clubes y miembros.",
  },
  {
    year: "1979",
    title: "La acción toma escala",
    body: "Rotary inicia en Filipinas un proyecto para inmunizar a seis millones de niños contra la polio, un antecedente de su compromiso global con la erradicación de la enfermedad.",
  },
];

const rotaryParts = [
  {
    number: "01",
    title: "Los clubes",
    body: "Personas que se reúnen, intercambian ideas, construyen relaciones y pasan a la acción en sus comunidades.",
  },
  {
    number: "02",
    title: "Rotary International",
    body: "La organización que apoya y coordina programas e iniciativas para conectar a los clubes en todo el mundo.",
  },
  {
    number: "03",
    title: "La Fundación Rotaria",
    body: "El brazo que proporciona fondos para actividades humanitarias locales y proyectos de alcance internacional.",
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
    title: "Directiva del club",
    body: "La plataforma está preparada para registrar cargos, periodos y responsabilidades. Los nombres de la directiva se publicarán cuando sean confirmados por el club.",
  },
  {
    number: "02",
    title: "Comités y equipos",
    body: "Cada comité podrá tener una descripción, una persona responsable y sus miembros. El directorio detallado será visible solo para personas autorizadas.",
  },
  {
    number: "03",
    title: "Proyectos y aliados",
    body: "Las propuestas y actividades podrán relacionarse con aliados, tareas, fechas y resultados para que el servicio tenga continuidad.",
  },
];

export default function NosotrosPage() {
  return (
    <PublicShell active="nosotros">
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <SectionLabel>Nosotros · Historia y estructura</SectionLabel>
            <h1>Una historia que empezó con una conversación. <em>Y sigue en comunidad.</em></h1>
            <p>Conoce el movimiento rotario, el marco que lo sostiene y la información institucional que el Club Rotario Santo Domingo Colonial irá haciendo pública.</p>
            <div className={styles.heroActions}>
              <a className={styles.buttonPrimary} href="#rotary-international">Leer la historia <ArrowUpRight /></a>
              <Link className={styles.textLink} href="#club">Conocer el club <ArrowUpRight /></Link>
            </div>
          </div>
          <div className={styles.heroStamp}>
            <div><span>1905 / HOY</span><span>ARCHIVO VIVO</span></div>
            <strong>Servir es<br /><em>organizarse.</em></strong>
            <small>La memoria local del club se construye con datos confirmados y voces de sus miembros.</small>
          </div>
        </section>

        <section className={styles.history} id="rotary-international">
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Rotary International</SectionLabel><h2>Un movimiento hecho de <span>vínculos.</span></h2></div>
            <p>Información editorial basada en las páginas oficiales de Rotary International.</p>
          </div>
          <div className={styles.historyLead}>
            <p>Rotary nació de una idea sencilla: reunir a personas de distintas profesiones para compartir ideas, crear amistades y servir. Con más de un siglo de recorrido, esa práctica sigue conectando clubes y comunidades alrededor del mundo.</p>
            <p>La historia internacional ofrece un contexto para entender el trabajo de cualquier club. La historia propia del Club Rotario Santo Domingo Colonial tendrá su espacio cuando sea entregada y revisada por su equipo.</p>
          </div>

          <div className={styles.timeline}>
            {timeline.map((item) => (
              <div className={styles.timelineItem} key={item.year}>
                <span className={styles.timelineYear}>{item.year}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
              </div>
            ))}
          </div>
          <a className={styles.sourceLink} href="https://www.rotary.org/es-mx/who-we-are/our-history" target="_blank" rel="noreferrer">Ver la historia completa en Rotary International <ArrowUpRight /></a>
        </section>

        <section className={styles.structure}>
          <div className={styles.sectionHeading}>
            <div><SectionLabel>Cómo se articula</SectionLabel><h2>Tres piezas. <span>Un mismo propósito.</span></h2></div>
            <p>La estructura oficial de Rotary International explicada en lenguaje claro.</p>
          </div>
          <div className={styles.partsGrid}>
            {rotaryParts.map((part) => (
              <article className={styles.partCard} key={part.number}>
                <span>{part.number}</span><h3>{part.title}</h3><p>{part.body}</p>
              </article>
            ))}
          </div>
          <a className={styles.sourceLink} href="https://www.rotary.org/es-mx/who-we-are/our-structure" target="_blank" rel="noreferrer">Consultar la estructura oficial <ArrowUpRight /></a>
        </section>

        <section className={styles.club} id="club">
          <div className={styles.clubIntro}>
            <SectionLabel>Club Rotario Santo Domingo Colonial</SectionLabel>
            <h2>La casa local de esta <em>conversación.</em></h2>
            <p>Este sitio está preparado para contar la vida del club con claridad: su memoria, sus personas, sus comités y la acción que decida compartir con la comunidad.</p>
            <p className={styles.notice}>La historia fundacional, los nombres de la directiva y los proyectos realizados se publicarán después de ser confirmados por la organización.</p>
            <a className={styles.buttonLight} href="mailto:club@rotariosantodomingo.org?subject=Información%20institucional%20del%20club">Compartir información del club <ArrowUpRight /></a>
          </div>
          <div className={styles.clubStructure}>
            <div className={styles.clubStructureHead}><span>Estructura preparada</span><span>01 — 03</span></div>
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

        <section className={styles.joinBand}>
          <div><SectionLabel>Ser parte</SectionLabel><h2>El servicio también necesita nuevas preguntas.</h2></div>
          <ArrowLink href="/auth/sign-up?next=/plataforma">Quiero conocer el club</ArrowLink>
        </section>
      </main>
    </PublicShell>
  );
}
