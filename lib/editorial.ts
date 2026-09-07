import "server-only";

import { cache } from "react";

import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

const CLUB_TIMEZONE = "America/Santo_Domingo";

export type EditorialSource = {
  label: string;
  href: string;
};

export type PublicStory = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  storyType: string;
  storyTypeLabel: string;
  publishedAt: string | null;
  coverImagePath: string | null;
  coverImageUrl?: string;
  isReference: boolean;
  isExample?: boolean;
  source?: EditorialSource;
};

export type PublicEvent = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  kind: string;
  kindLabel: string;
  tone: "lime" | "sun" | "coral" | "teal";
  startsAt: string;
  endsAt: string | null;
  venueName: string | null;
  venueAddress: string | null;
  locationUrl: string | null;
  capacity: number | null;
  coverImagePath: string | null;
  coverImageUrl?: string;
};

const storyTypeLabels: Record<string, string> = {
  cronica: "Crónica",
  voces: "Voces del club",
  archivo: "Archivo",
  noticia: "Noticia",
  otro: "Historia",
};

const eventKindLabels: Record<string, string> = {
  encuentro: "Encuentro",
  servicio: "Servicio",
  plataforma: "Plataforma",
  reunion: "Reunión",
  otro: "Actividad",
};

const eventTones = new Set<PublicEvent["tone"]>(["lime", "sun", "coral", "teal"]);

const ROTARY_HISTORY_SOURCE = {
  label: "Rotary International · Nuestra historia",
  href: "https://www.rotary.org/es-mx/who-we-are/our-history",
} as const;

const ROTARY_STRUCTURE_SOURCE = {
  label: "Rotary International · Nuestra estructura",
  href: "https://www.rotary.org/es-mx/who-we-are/our-structure",
} as const;

const ROTARY_FOCUS_SOURCE = {
  label: "Rotary International · Áreas de interés",
  href: "https://www.rotary.org/es-mx/our-causes",
} as const;

/**
 * These are reference readings, separate from club-published stories. They
 * make the public magazine useful while the club's own editorial archive is
 * being confirmed and populated by its team.
 */
const editorialGuides: PublicStory[] = [
  {
    id: "reference:historia-de-rotary-international",
    title: "La historia de Rotary International comenzó con una conversación",
    slug: "historia-de-rotary-international",
    excerpt:
      "Del primer encuentro de cuatro personas en Chicago a una red internacional unida por el servicio.",
    content: [
      "El 23 de febrero de 1905, el abogado Paul P. Harris convocó en Chicago la primera reunión de lo que sería el primer club rotario. A su lado estuvieron Gustavus Loehr, Silvester Schiele y Hiram Shorey.",
      "La idea inicial era crear un espacio donde profesionales de distintas áreas pudieran intercambiar ideas y construir amistades. Con el tiempo, esa conexión se convirtió también en una vocación humanitaria: organizarse para responder a necesidades concretas.",
      "En agosto de 1910, los 16 clubes existentes se unieron en la National Association of Rotary Clubs, hoy Rotary International. La expansión internacional comenzó temprano y llevó el movimiento a clubes en distintos continentes.",
      "Esta lectura presenta una síntesis editorial basada en el archivo oficial de Rotary International. No describe la historia particular del Club Rotario Santo Domingo Colonial; esa memoria local se publicará cuando sea revisada por su directiva.",
    ].join("\n\n"),
    storyType: "archivo",
    storyTypeLabel: "Referencia Rotary International",
    publishedAt: null,
    coverImagePath: "/zona-colonial-dusk.png",
    isReference: true,
    source: ROTARY_HISTORY_SOURCE,
  },
  {
    id: "reference:como-funciona-rotary",
    title: "Cómo se organiza Rotary para convertir vínculos en servicio",
    slug: "como-funciona-rotary",
    excerpt:
      "Clubes, Rotary International y La Fundación Rotaria: tres piezas que trabajan juntas para generar cambio duradero.",
    content: [
      "Rotary International explica su organización a partir de tres partes que se complementan. Los clubes reúnen a personas para intercambiar ideas, formar relaciones y pasar a la acción.",
      "Rotary International apoya y coordina programas e iniciativas que conectan a los clubes alrededor del mundo. La Fundación Rotaria proporciona fondos para actividades humanitarias, tanto en las comunidades como en proyectos de alcance internacional.",
      "En el ámbito de cada club, esta estructura se expresa en reuniones, comités, proyectos, alianzas y espacios de aprendizaje. La forma concreta de trabajar corresponde a cada club y debe quedar documentada por sus propios miembros.",
      "En el Club Rotario Santo Domingo Colonial, la plataforma en desarrollo servirá para ordenar esas conversaciones, responsabilidades y actividades cuando la estructura interna sea validada y publicada por el club.",
    ].join("\n\n"),
    storyType: "archivo",
    storyTypeLabel: "Referencia Rotary International",
    publishedAt: null,
    coverImagePath: "/zona-colonial-courtyard.png",
    isReference: true,
    source: ROTARY_STRUCTURE_SOURCE,
  },
  {
    id: "reference:areas-de-interes-de-rotary",
    title: "Siete caminos para enfocar el impacto",
    slug: "areas-de-interes-de-rotary",
    excerpt:
      "Las áreas de interés de Rotary ayudan a convertir una intención de servicio en una conversación con rumbo.",
    content: [
      "Rotary concentra sus esfuerzos en siete áreas de interés: promover la paz; combatir enfermedades; suministrar agua, saneamiento e higiene; proteger la salud materno-infantil; apoyar la educación y la alfabetización; impulsar el desarrollo económico de las comunidades; y proteger el medioambiente.",
      "Las áreas no sustituyen la escucha local. Funcionan como un marco para investigar una necesidad, sumar capacidades, elegir aliados y evaluar si una acción está produciendo un resultado útil y sostenible.",
      "Cada club puede encontrar su propia manera de trabajar estas prioridades. En esta revista, los proyectos y actividades del Club Rotario Santo Domingo Colonial aparecerán como historias verificadas por el equipo editorial del club.",
    ].join("\n\n"),
    storyType: "archivo",
    storyTypeLabel: "Referencia Rotary International",
    publishedAt: null,
    coverImagePath: "/zona-colonial-fortaleza.png",
    isReference: true,
    source: ROTARY_FOCUS_SOURCE,
  },
  {
    id: "sample:una-plaza-que-guarda-nuestras-conversaciones",
    title: "Una plaza que guarda nuestras conversaciones",
    slug: "una-plaza-que-guarda-nuestras-conversaciones",
    excerpt:
      "Una publicación de prueba para contar cómo el Alcázar y su plaza pueden acompañar la memoria del club.",
    content: [
      "El Alcázar de Colón mira hacia la Plaza de España, un espacio abierto donde la Ciudad Colonial reúne visitantes, vecinos e historias. Esta escena sirve como referencia visual para narrar el lugar que acompaña nuestras conversaciones.",
      "Este texto de muestra deja listo el formato para que el club publique después sus propias fotografías, voces y aprendizajes junto a un proyecto de servicio.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/alcazar-colon-illustration.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:el-lugar-tambien-cuenta",
    title: "El lugar también cuenta",
    slug: "el-lugar-tambien-cuenta",
    excerpt:
      "Otra crónica de prueba para conectar el servicio, el patrimonio y las personas que hacen comunidad.",
    content: [
      "Una imagen del Alcázar puede abrir una historia sobre cuidado, patrimonio y participación. La publicación final podrá sumar la fecha de la actividad, las organizaciones aliadas y las voces de quienes estuvieron presentes.",
      "Mientras se prepara el archivo propio del club, este ejemplo muestra cómo una fotografía realista del entorno puede sostener una narración breve y cercana.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/alcazar-colon-illustration.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:cuando-una-reunion-se-convierte-en-un-proyecto",
    title: "Cuando una reunión se convierte en un proyecto",
    slug: "cuando-una-reunion-se-convierte-en-un-proyecto",
    excerpt:
      "Una guía editorial para contar el paso de la conversación a una acción concreta.",
    content: [
      "Toda buena iniciativa empieza con una conversación que ayuda a mirar una necesidad desde varios ángulos. La reunión permite poner sobre la mesa preguntas, capacidades y personas dispuestas a colaborar.",
      "El proyecto toma forma cuando el equipo acuerda un propósito, una siguiente acción y una manera sencilla de revisar lo aprendido. Esta pieza es un ejemplo de cómo una publicación puede contar ese recorrido sin perder la voz de quienes participaron.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-las-damas.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:escuchar-primero-el-comienzo-de-todo-servicio",
    title: "Escuchar primero: el comienzo de todo servicio",
    slug: "escuchar-primero-el-comienzo-de-todo-servicio",
    excerpt:
      "Una crónica de muestra sobre las preguntas que ayudan a elegir una causa con sentido.",
    content: [
      "Antes de elegir una solución, un equipo de servicio necesita acercarse a las personas que viven la situación. Escuchar con atención evita suposiciones y abre espacio para reconocer los recursos que ya existen en la comunidad.",
      "Una historia editorial puede registrar esas voces, las preguntas que cambiaron el rumbo y el acuerdo que permitió avanzar. El resultado es una memoria útil para el club y para quienes quieran sumarse después.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-illustration.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:alianzas-que-suman-capacidades",
    title: "Alianzas que suman capacidades",
    slug: "alianzas-que-suman-capacidades",
    excerpt:
      "Un formato de publicación para mostrar cómo varias manos pueden sostener una misma iniciativa.",
    content: [
      "Los proyectos que perduran suelen reunir conocimientos distintos. Una organización aporta experiencia, otra conoce el territorio y un grupo de voluntariado convierte el plan en presencia constante.",
      "Contar la alianza ayuda a reconocer cada aporte y deja una ruta para repetir lo que funcionó. Esta publicación de ejemplo está pensada para documentar acuerdos, aprendizajes y próximos pasos.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/colonial-streets.jpg",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:la-ciudad-colonial-como-punto-de-encuentro",
    title: "La Ciudad Colonial como punto de encuentro",
    slug: "la-ciudad-colonial-como-punto-de-encuentro",
    excerpt:
      "Una pieza visual de muestra para conectar la vida del club con el lugar que comparte.",
    content: [
      "Los lugares también guardan historias. Una plaza, una calle o una sala de reunión pueden convertirse en el punto donde las personas se reconocen, intercambian ideas y deciden volver a encontrarse.",
      "La revista puede usar ese paisaje como hilo conductor para presentar actividades, alianzas y recuerdos. Así, cada publicación se siente parte de una misma memoria local.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-night.jpg",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:aprender-para-servir-mejor",
    title: "Aprender para servir mejor",
    slug: "aprender-para-servir-mejor",
    excerpt:
      "Una lectura de muestra sobre el aprendizaje que queda después de cada actividad.",
    content: [
      "Cada actividad deja algo más que una fotografía. El equipo descubre qué preguntas conviene hacer antes, qué tarea necesita más tiempo y qué decisión permitió cuidar mejor a las personas participantes.",
      "Guardar esas conclusiones convierte una experiencia puntual en conocimiento compartido. Este ejemplo muestra cómo una crónica puede cerrar con aprendizajes claros y una invitación a continuar.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-dusk.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:una-invitacion-abierta-al-companerismo",
    title: "Una invitación abierta al compañerismo",
    slug: "una-invitacion-abierta-al-companerismo",
    excerpt:
      "Un ejemplo de historia para explicar cómo una persona puede acercarse al club por primera vez.",
    content: [
      "El compañerismo se construye cuando hay espacio para llegar con preguntas, conocer a otras personas y encontrar una forma propia de aportar. La invitación no necesita prometer respuestas perfectas: necesita abrir una conversación honesta.",
      "Una publicación como esta puede presentar el ambiente del club, explicar el próximo paso y mostrar que el servicio también empieza por sentirse parte de una comunidad.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-courtyard.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:pequenas-acciones-memoria-duradera",
    title: "Pequeñas acciones, memoria duradera",
    slug: "pequenas-acciones-memoria-duradera",
    excerpt:
      "Una propuesta de crónica para mostrar el valor de los detalles que sostienen un proyecto.",
    content: [
      "Hay acciones que parecen pequeñas hasta que se miran juntas: una llamada, una visita, una mesa preparada o una persona que vuelve para ayudar. La memoria del servicio se forma con esos gestos repetidos.",
      "El archivo editorial puede reunirlos con fotografías, fechas y voces breves. Este texto de muestra sirve como base para futuras historias del Club Rotario Santo Domingo Colonial.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-fortaleza.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:el-diario-de-un-club-que-escucha",
    title: "El diario de un club que escucha",
    slug: "el-diario-de-un-club-que-escucha",
    excerpt:
      "Un formato de diario para reunir notas, acuerdos y escenas de la vida rotaria.",
    content: [
      "Un diario editorial no tiene que esperar a la gran noticia. Puede comenzar con una escena de reunión, una pregunta que quedó abierta o una idea que necesita más personas alrededor.",
      "Publicar esas notas con orden ayuda a que el club vea su propio proceso y permite que la comunidad siga el camino desde cerca. Esta pieza está pensada como una plantilla narrativa para ese archivo.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-las-damas.png",
    isReference: true,
    isExample: true,
  },
  {
    id: "sample:el-archivo-que-construimos-juntos",
    title: "El archivo que construimos juntos",
    slug: "el-archivo-que-construimos-juntos",
    excerpt:
      "Una publicación de muestra para presentar la revista como memoria viva del club.",
    content: [
      "Una revista social se vuelve más valiosa con el tiempo: cada texto suma contexto, cada imagen devuelve una conversación y cada fecha ayuda a entender cómo creció una iniciativa.",
      "El archivo del club se irá construyendo con publicaciones revisadas por sus miembros. Esta muestra señala el lugar donde caben las próximas voces, proyectos y aprendizajes.",
    ].join("\n\n"),
    storyType: "muestra",
    storyTypeLabel: "Ejemplo editorial",
    publishedAt: null,
    coverImagePath: "/zona-colonial-illustration.png",
    isReference: true,
    isExample: true,
  },
];

type StoryRecord = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  story_type: string;
  published_at: string | null;
  cover_image_path: string | null;
};

const PUBLIC_STORY_SELECT = "id,title,slug,excerpt,content,story_type,published_at,cover_image_path";

type EventRecord = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  kind: string;
  tone: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  location_url: string | null;
  capacity: number | null;
  cover_image_path: string | null;
};

function publicImageUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null) {
  if (!path) return undefined;
  if (path.startsWith("/")) return undefined;
  if (path.startsWith("https://")) return path;
  if (path.startsWith("http://")) return undefined;
  return supabase.storage.from("club-public").getPublicUrl(path).data.publicUrl;
}

function mapStory(
  record: StoryRecord,
  supabase: Awaited<ReturnType<typeof createClient>>,
): PublicStory {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    excerpt: record.excerpt ?? "Una historia de servicio del Club Rotario Santo Domingo Colonial.",
    content: record.content,
    storyType: record.story_type,
    storyTypeLabel: storyTypeLabels[record.story_type] ?? "Historia",
    publishedAt: record.published_at,
    coverImagePath: record.cover_image_path,
    coverImageUrl: publicImageUrl(supabase, record.cover_image_path),
    isReference: false,
  };
}

function mapEvent(
  record: EventRecord,
  supabase: Awaited<ReturnType<typeof createClient>>,
): PublicEvent {
  const tone = eventTones.has(record.tone as PublicEvent["tone"])
    ? (record.tone as PublicEvent["tone"])
    : "lime";

  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    summary: record.summary ?? "Actividad pública del Club Rotario Santo Domingo Colonial.",
    description: record.description ?? record.summary ?? "Los detalles se confirmarán próximamente.",
    kind: record.kind,
    kindLabel: eventKindLabels[record.kind] ?? "Actividad",
    tone,
    startsAt: record.starts_at,
    endsAt: record.ends_at,
    venueName: record.venue_name,
    venueAddress: record.venue_address,
    locationUrl: record.location_url,
    capacity: record.capacity,
    coverImagePath: record.cover_image_path,
    coverImageUrl: publicImageUrl(supabase, record.cover_image_path),
  };
}

export function getEditorialGuides() {
  return editorialGuides;
}

export const getPublicStories = cache(async (limit = 12): Promise<PublicStory[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select(PUBLIC_STORY_SELECT)
      .eq("status", "published")
      .eq("is_public", true)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return ((data ?? []) as StoryRecord[]).map((record) => mapStory(record, supabase));
  } catch {
    return [];
  }
});

export type PublicStoriesPage = {
  stories: PublicStory[];
  total: number;
  page: number;
  pageSize: number;
  hasClubStories: boolean;
};

function getGuidePage(page: number, pageSize: number): PublicStoriesPage {
  const total = editorialGuides.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const resolvedPage = Math.min(page, totalPages);
  const from = (resolvedPage - 1) * pageSize;

  return {
    stories: editorialGuides.slice(from, from + pageSize),
    total,
    page: resolvedPage,
    pageSize,
    hasClubStories: false,
  };
}

export const getPublicStoriesPage = cache(async (page = 1, pageSize = 9): Promise<PublicStoriesPage> => {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 9;

  if (!isSupabaseConfigured()) return getGuidePage(safePage, safePageSize);

  try {
    const supabase = await createClient();
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;
    const { data, error, count } = await supabase
      .from("stories")
      .select(PUBLIC_STORY_SELECT, { count: "exact" })
      .eq("status", "published")
      .eq("is_public", true)
      .order("published_at", { ascending: false })
      .range(from, to);

    if (error) return getGuidePage(safePage, safePageSize);

    const records = (data ?? []) as StoryRecord[];
    if (records.length === 0 && (count ?? 0) === 0) return getGuidePage(safePage, safePageSize);

    if (records.length === 0 && count && from >= count) {
      const lastPage = Math.max(1, Math.ceil(count / safePageSize));
      const lastFrom = (lastPage - 1) * safePageSize;
      const { data: lastData, error: lastError } = await supabase
        .from("stories")
        .select(PUBLIC_STORY_SELECT)
        .eq("status", "published")
        .eq("is_public", true)
        .order("published_at", { ascending: false })
        .range(lastFrom, count - 1);

      if (lastError) return getGuidePage(safePage, safePageSize);

      return {
        stories: ((lastData ?? []) as StoryRecord[]).map((record) => mapStory(record, supabase)),
        total: count,
        page: lastPage,
        pageSize: safePageSize,
        hasClubStories: true,
      };
    }

    return {
      stories: records.map((record) => mapStory(record, supabase)),
      total: count ?? from + records.length,
      page: safePage,
      pageSize: safePageSize,
      hasClubStories: true,
    };
  } catch {
    return getGuidePage(safePage, safePageSize);
  }
});

export const getPublicStory = cache(async (slug: string): Promise<PublicStory | null> => {
  const guide = editorialGuides.find((item) => item.slug === slug);

  if (!isSupabaseConfigured()) return guide ?? null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select(PUBLIC_STORY_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .eq("is_public", true)
      .maybeSingle();

    if (!error && data) return mapStory(data as StoryRecord, supabase);
  } catch {
    // The reference guide remains available if the public content store is unavailable.
  }

  return guide ?? null;
});

export const getPublicEvents = cache(async (): Promise<PublicEvent[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("events")
      .select(
        "id,title,slug,summary,description,kind,tone,starts_at,ends_at,venue_name,venue_address,location_url,capacity,cover_image_path",
      )
      .eq("status", "published")
      .eq("is_public", true)
      .order("starts_at", { ascending: true })
      .limit(40);

    if (error) return [];
    return ((data ?? []) as EventRecord[]).map((record) => mapEvent(record, supabase));
  } catch {
    return [];
  }
});

export const getPublicEvent = cache(async (slug: string): Promise<PublicEvent | null> => {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("events")
      .select(
        "id,title,slug,summary,description,kind,tone,starts_at,ends_at,venue_name,venue_address,location_url,capacity,cover_image_path",
      )
      .eq("slug", slug)
      .eq("status", "published")
      .eq("is_public", true)
      .maybeSingle();

    if (error || !data) return null;
    return mapEvent(data as EventRecord, supabase);
  } catch {
    return null;
  }
});

export function isUpcoming(value: string) {
  return new Date(value).getTime() >= Date.now();
}

export function clubDate(value: string | null | undefined) {
  if (!value) return "Fecha por confirmar";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "long",
    timeZone: CLUB_TIMEZONE,
  }).format(new Date(value));
}
