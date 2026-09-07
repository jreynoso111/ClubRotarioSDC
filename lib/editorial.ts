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
      .select("id,title,slug,excerpt,content,story_type,published_at,cover_image_path")
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

export const getPublicStory = cache(async (slug: string): Promise<PublicStory | null> => {
  const guide = editorialGuides.find((item) => item.slug === slug);

  if (!isSupabaseConfigured()) return guide ?? null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stories")
      .select("id,title,slug,excerpt,content,story_type,published_at,cover_image_path")
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
