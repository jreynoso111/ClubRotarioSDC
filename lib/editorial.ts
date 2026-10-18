import "server-only";

import { cache } from "react";

import { isSupabaseConfigured } from "@/utils/supabase/config";
import { toPublicSupabaseUrl } from "@/utils/supabase/public-url";
import { createClient } from "@/utils/supabase/server";

import { parseEditorialContent, type EditorialArticleContent } from "@/lib/editorial-content";
import {
  awaitPublicContent,
  PublicContentUnavailableError,
  withPublicContentTimeout,
} from "@/lib/supabase/timeout";

type PublicSupabase = Awaited<ReturnType<typeof createClient>>;

export type PublicStory = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  storyType: string;
  storyTypeLabel: string;
  publishedAt: string | null;
  updatedAt: string | null;
  coverImageUrl: string | null;
  editorial?: EditorialArticleContent & { inlineImageUrl: string | null; galleryImageUrls: Array<string | null> };
};

export type PublicStoriesPage = {
  stories: PublicStory[];
  total: number;
  page: number;
  pageSize: number;
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
  updatedAt: string | null;
  // Cancelled events keep their public page so shared links explain what happened.
  cancelled: boolean;
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

type StoryRecord = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  story_type: string;
  published_at: string | null;
  updated_at: string;
  cover_image_path: string | null;
};

const PUBLIC_STORY_SELECT = "id,title,slug,excerpt,content,story_type,published_at,updated_at,cover_image_path";

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
  updated_at: string;
  status?: string;
};

const PUBLIC_EVENT_SELECT =
  "id,title,slug,summary,description,kind,tone,starts_at,ends_at,venue_name,venue_address,location_url,capacity,cover_image_path,updated_at";

/**
 * Stories and events store either a static site illustration ("/name.png") or
 * a file in the public club bucket ("stories/<file>"). Anything else, including
 * external URLs, resolves to null so pages never render an unreviewed host.
 */
export function publicImageUrl(supabase: PublicSupabase, path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return /^\/(?!\/)[^\\\s]*$/.test(path) ? path : null;
  if (path.startsWith("stories/") && !path.includes("..") && !path.includes("\\")) {
    return toPublicSupabaseUrl(supabase.storage.from("club-public").getPublicUrl(path).data.publicUrl);
  }
  return null;
}

// The column list keeps its literal type so Supabase infers the row shape.
function publishedStoriesQuery(supabase: PublicSupabase, columns: typeof PUBLIC_STORY_SELECT, options?: { count?: "exact" }) {
  return supabase
    .from("stories")
    .select(columns, options)
    .eq("status", "published")
    .eq("is_public", true)
    .order("published_at", { ascending: false });
}

function mapStory(record: StoryRecord, supabase: PublicSupabase): PublicStory {
  const editorial = parseEditorialContent(record.content);
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    excerpt: record.excerpt ?? "Una historia de servicio del Club Rotario Santo Domingo Colonial.",
    content: record.content,
    storyType: record.story_type,
    storyTypeLabel: storyTypeLabels[record.story_type] ?? "Historia",
    publishedAt: record.published_at,
    updatedAt: record.updated_at,
    coverImageUrl: publicImageUrl(supabase, record.cover_image_path),
    editorial: editorial
      ? {
          ...editorial,
          inlineImageUrl: publicImageUrl(supabase, editorial.inlineImagePath),
          galleryImageUrls: editorial.gallery.map((image) => publicImageUrl(supabase, image.path)),
        }
      : undefined,
  };
}

function mapStories(records: StoryRecord[] | null | undefined, supabase: PublicSupabase): PublicStory[] {
  return (records ?? []).map((record) => mapStory(record, supabase));
}

function mapEvent(record: EventRecord, supabase: PublicSupabase): PublicEvent {
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
    coverImageUrl: publicImageUrl(supabase, record.cover_image_path) ?? undefined,
    updatedAt: record.updated_at,
    cancelled: record.status === "cancelled",
  };
}

/** Published stories for listings and recommendations. Failures render as an empty list. */
export const getPublicStories = cache(async (limit = 12): Promise<PublicStory[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const supabase = await createClient();
    const result = await withPublicContentTimeout(
      publishedStoriesQuery(supabase, PUBLIC_STORY_SELECT).limit(limit),
      null,
    );

    if (!result || result.error) return [];
    return mapStories(result.data as StoryRecord[] | null, supabase);
  } catch {
    return [];
  }
});

/** One page of published stories. Failures render as an empty archive, never as sample content. */
export const getPublicStoriesPage = cache(async (page = 1, pageSize = 9): Promise<PublicStoriesPage> => {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 9;
  const emptyPage: PublicStoriesPage = { stories: [], total: 0, page: 1, pageSize: safePageSize };

  if (!isSupabaseConfigured()) return emptyPage;

  try {
    const supabase = await createClient();
    const from = (safePage - 1) * safePageSize;
    const result = await withPublicContentTimeout(
      publishedStoriesQuery(supabase, PUBLIC_STORY_SELECT, { count: "exact" }).range(from, from + safePageSize - 1),
      null,
    );

    if (!result || result.error) return emptyPage;

    const records = (result.data ?? []) as StoryRecord[];
    const total = result.count ?? from + records.length;
    if (total === 0) return emptyPage;

    if (records.length === 0 && from >= total) {
      // A page past the end shows the last page, so old links still lead to the archive.
      const lastPage = Math.max(1, Math.ceil(total / safePageSize));
      const lastFrom = (lastPage - 1) * safePageSize;
      const lastResult = await withPublicContentTimeout(
        publishedStoriesQuery(supabase, PUBLIC_STORY_SELECT).range(lastFrom, total - 1),
        null,
      );

      if (!lastResult || lastResult.error) return emptyPage;
      return {
        stories: mapStories(lastResult.data as StoryRecord[] | null, supabase),
        total,
        page: lastPage,
        pageSize: safePageSize,
      };
    }

    return {
      stories: mapStories(records, supabase),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  } catch {
    return emptyPage;
  }
});

/**
 * One published story. A query that succeeds without a row returns null, which
 * the page answers with notFound(). A failed or slow read throws instead, so the
 * error boundary renders and an existing story is never reported as missing.
 */
export const getPublicStory = cache(async (slug: string): Promise<PublicStory | null> => {
  if (!isSupabaseConfigured()) {
    throw new PublicContentUnavailableError("Falta la configuración pública de Supabase.");
  }

  const supabase = await createClient();
  const result = await awaitPublicContent(
    supabase
      .from("stories")
      .select(PUBLIC_STORY_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .eq("is_public", true)
      .maybeSingle(),
  );

  if (result.error) throw new PublicContentUnavailableError(result.error.message);
  return result.data ? mapStory(result.data as StoryRecord, supabase) : null;
});

export const getPublicEvents = cache(async (): Promise<PublicEvent[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const supabase = await createClient();
    const result = await withPublicContentTimeout(
      supabase
        .from("events")
        .select(PUBLIC_EVENT_SELECT)
        .eq("status", "published")
        .eq("is_public", true)
        .order("starts_at", { ascending: true })
        .limit(40),
      null,
    );

    if (!result) return [];
    const { data, error } = result;

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
    const result = await withPublicContentTimeout(
      supabase
        .from("events")
        .select(`${PUBLIC_EVENT_SELECT},status`)
        .eq("slug", slug)
        .in("status", ["published", "cancelled"])
        .eq("is_public", true)
        .maybeSingle(),
      null,
    );

    if (!result || result.error || !result.data) return null;
    return mapEvent(result.data as EventRecord, supabase);
  } catch {
    return null;
  }
});

export function isUpcoming(value: string) {
  return new Date(value).getTime() >= Date.now();
}
