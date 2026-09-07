import "server-only";

import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

const CLUB_TIMEZONE = "America/Santo_Domingo";

export type PublicEvent = {
  href: string;
  date: string;
  time: string;
  title: string;
  detail: string;
  kind: string;
  tone: string;
};

export type PublicStory = {
  href: string;
  index: string;
  type: string;
  title: string;
  excerpt: string;
  color: string;
  image?: string;
  imageAlt?: string;
};

// Public events come from Supabase. Keep this empty so a missing connection
// never presents synthetic activities as if they were real club events.
const fallbackEvents: PublicEvent[] = [];

// Evergreen editorial guides, never invented club activities or testimonies.
const fallbackStories: PublicStory[] = [
  { index: "01", type: "CONOCE ROTARY", title: "Una idea de amistad que se convirtió en servicio", excerpt: "Descubre el origen de Rotary International y cómo comenzó una red de personas comprometidas con sus comunidades.", color: "story-yellow", image: "/zona-colonial-illustration.png", imageAlt: "Ilustración de la Ciudad Colonial", href: "/revista/historia-de-rotary-international" },
  { index: "02", type: "VIDA ROTARIA", title: "Un club, muchas maneras de aportar", excerpt: "Compañerismo, liderazgo y proyectos: conoce cómo se organiza Rotary y dónde puede encajar tu vocación de servicio.", color: "story-coral", href: "/revista/como-funciona-rotary" },
  { index: "03", type: "NUESTRAS CAUSAS", title: "Siete causas para construir un futuro mejor", excerpt: "De la paz al medioambiente: las áreas de interés que orientan el servicio de Rotary en el mundo.", color: "story-teal", image: "/zona-colonial-courtyard.png", imageAlt: "Ilustración de un patio colonial", href: "/revista/areas-de-interes-de-rotary" },
  { index: "04", type: "CIUDAD COLONIAL", title: "Una plaza que guarda nuestras conversaciones", excerpt: "Una publicación de prueba para contar cómo el lugar que compartimos también puede ser parte de la memoria del club.", color: "story-yellow", image: "/alcazar-colon-illustration.png", imageAlt: "Ilustración del Alcázar de Colón en la Plaza de España", href: "/revista/una-plaza-que-guarda-nuestras-conversaciones" },
];

type EventRecord = {
  slug: string;
  starts_at: string;
  title: string;
  summary: string | null;
  kind: string;
  tone: string;
  venue_name: string | null;
  venue_address: string | null;
};

type StoryRecord = {
  title: string;
  slug: string;
  excerpt: string | null;
  story_type: string;
  cover_image_path: string | null;
};

function formatEventDate(isoDate: string) {
  const date = new Date(isoDate);
  const dayLabel = new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    timeZone: CLUB_TIMEZONE,
  }).format(date);
  const monthLabel = new Intl.DateTimeFormat("es-DO", {
    month: "short",
    timeZone: CLUB_TIMEZONE,
  })
    .format(date)
    .replaceAll(".", "")
    .toUpperCase();
  const dateLabel = `${dayLabel} ${monthLabel}`;
  const timeLabel = new Intl.DateTimeFormat("es-DO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: CLUB_TIMEZONE,
  }).format(date);

  return { date: dateLabel, time: timeLabel };
}

function mapEvent(record: EventRecord): PublicEvent {
  const { date, time } = formatEventDate(record.starts_at);
  const kind =
    {
      encuentro: "Encuentro",
      servicio: "Servicio",
      plataforma: "Plataforma",
      reunion: "Reunión",
      otro: "Actividad",
    }[record.kind] ?? "Actividad";

  return {
    href: `/eventos/${record.slug}`,
    date,
    time,
    title: record.title,
    detail:
      [record.venue_name, record.venue_address].filter(Boolean).join(" · ") ||
      record.summary ||
      "Ubicación por confirmar",
    kind,
    tone: record.tone,
  };
}

function mapStory(record: StoryRecord, index: number, publicImageUrl?: string): PublicStory {
  const type =
    {
      cronica: "CRÓNICA",
      voces: "VOCES DEL CLUB",
      archivo: "ARCHIVO",
      noticia: "NOTICIA",
      otro: "HISTORIA",
    }[record.story_type] ?? "HISTORIA";
  const colors = ["story-yellow", "story-coral", "story-teal"];

  return {
    href: `/revista/${record.slug}`,
    index: String(index + 1).padStart(2, "0"),
    type,
    title: record.title,
    excerpt: record.excerpt ?? "Una historia de servicio del Club Rotario Santo Domingo Colonial.",
    color: colors[index % colors.length],
    image: publicImageUrl,
    imageAlt: record.title,
  };
}

export async function getPublicFeed(): Promise<{
  events: PublicEvent[];
  stories: PublicStory[];
}> {
  if (!isSupabaseConfigured()) {
    return { events: fallbackEvents, stories: fallbackStories };
  }

  try {
    const supabase = await createClient();
    const now = new Date().toISOString();
    const [{ data: upcomingEventData }, { data: previousEventData }, { data: storyData }] = await Promise.all([
      supabase
        .from("events")
        .select("slug,starts_at,title,summary,kind,tone,venue_name,venue_address")
        .eq("status", "published")
        .eq("is_public", true)
        .gte("starts_at", now)
        .order("starts_at", { ascending: true })
        .limit(3),
      supabase
        .from("events")
        .select("slug,starts_at,title,summary,kind,tone,venue_name,venue_address")
        .eq("status", "published")
        .eq("is_public", true)
        .lt("starts_at", now)
        .order("starts_at", { ascending: false })
        .limit(3),
      supabase
        .from("stories")
        .select("title,slug,excerpt,story_type,cover_image_path")
        .eq("status", "published")
        .eq("is_public", true)
        .order("published_at", { ascending: false })
        .limit(12),
    ]);

    const upcomingEvents = ((upcomingEventData ?? []) as EventRecord[]).map(mapEvent);
    const previousEvents = ((previousEventData ?? []) as EventRecord[]).map(mapEvent);
    const events = [
      ...upcomingEvents,
      ...previousEvents.slice(0, Math.max(0, 3 - upcomingEvents.length)),
    ];
    const stories = ((storyData ?? []) as StoryRecord[]).map((story, index) => {
      const imageUrl = story.cover_image_path?.startsWith("http")
        ? story.cover_image_path
        : story.cover_image_path
          ? supabase.storage.from("club-public").getPublicUrl(story.cover_image_path).data.publicUrl
          : undefined;
      return mapStory(story, index, imageUrl);
    });

    return {
      events: events.length > 0 ? events : fallbackEvents,
      stories: stories.length > 0 ? stories : fallbackStories,
    };
  } catch {
    return { events: fallbackEvents, stories: fallbackStories };
  }
}
