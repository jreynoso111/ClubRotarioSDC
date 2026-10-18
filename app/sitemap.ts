import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { getPublicEvents, getPublicStories } from "@/lib/editorial";
import { getPublicSiteOrigin } from "@/utils/site-url";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: "/", changeFrequency: "weekly", priority: 1 },
  { url: "/revista", changeFrequency: "weekly", priority: 0.8 },
  { url: "/eventos", changeFrequency: "weekly", priority: 0.8 },
  { url: "/nosotros", changeFrequency: "monthly", priority: 0.7 },
  { url: "/solicitar-membresia", changeFrequency: "monthly", priority: 0.6 },
];

// The sitemap protocol allows 50,000 URLs; the club publishes far fewer.
const CONTENT_LIMIT = 1000;

// A failed content read should only remove those URLs, never the static pages.
async function listOrEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Request-time read so newly published stories and events appear without a redeploy.
  await connection();

  const origin = getPublicSiteOrigin();
  const [stories, events] = await Promise.all([
    listOrEmpty(() => getPublicStories(CONTENT_LIMIT)),
    listOrEmpty(() => getPublicEvents()),
  ]);

  return [
    ...STATIC_ROUTES.map((route) => ({ ...route, url: `${origin}${route.url}` })),
    ...stories.map((story) => ({
      url: `${origin}/revista/${story.slug}`,
      lastModified: story.updatedAt ?? story.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...events.map((event) => ({
      url: `${origin}/eventos/${event.slug}`,
      lastModified: event.updatedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
