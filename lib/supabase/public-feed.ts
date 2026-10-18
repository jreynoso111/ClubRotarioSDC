import "server-only";

import { publicImageUrl } from "@/lib/editorial";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

import { withPublicContentTimeout } from "./timeout";

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

export type PublicFeed = {
  events: PublicEvent[];
  stories: PublicStory[];
};

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

// The home page only shows what the club has published. When nothing is
// available (no connection, timeout or an empty store), both lists stay empty
// and the page renders its own empty states.
function emptyFeed(): PublicFeed {
  return { events: [], stories: [] };
}

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

function mapStory(record: StoryRecord, index: number, publicImageSrc?: string): PublicStory {
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
    image: publicImageSrc,
    imageAlt: record.title,
  };
}

export async function getPublicFeed(): Promise<PublicFeed> {
  if (!isSupabaseConfigured()) return emptyFeed();

  try {
    const supabase = await createClient();
    const now = new Date().toISOString();
    const queryResult = await withPublicContentTimeout(
      Promise.all([
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
      ]),
      null,
    );

    if (!queryResult) return emptyFeed();

    const [{ data: upcomingEventData }, { data: previousEventData }, { data: storyData }] = queryResult;

    const upcomingEvents = ((upcomingEventData ?? []) as EventRecord[]).map(mapEvent);
    const previousEvents = ((previousEventData ?? []) as EventRecord[]).map(mapEvent);
    const events = [
      ...upcomingEvents,
      ...previousEvents.slice(0, Math.max(0, 3 - upcomingEvents.length)),
    ];
    const stories = ((storyData ?? []) as StoryRecord[]).map((story, index) =>
      mapStory(story, index, publicImageUrl(supabase, story.cover_image_path) ?? undefined),
    );

    return { events, stories };
  } catch {
    return emptyFeed();
  }
}
