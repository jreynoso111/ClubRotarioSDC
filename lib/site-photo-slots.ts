import "server-only";

import { cache } from "react";

import { withPublicContentTimeout } from "@/lib/supabase/timeout";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { toPublicSupabaseUrl } from "@/utils/supabase/public-url";
import { createClient } from "@/utils/supabase/server";

import {
  isSitePhotoAssetPath,
  SITE_PHOTO_SLOTS,
  type SitePhotoSlotKey,
} from "./site-photos";

export type SitePhoto = {
  url: string;
  alt: string;
  caption: string | null;
  isCustom: boolean;
};

export type SitePhotos = Record<SitePhotoSlotKey, SitePhoto>;

type PublishedPhotoRow = {
  slot_key: string;
  image_path: string | null;
  alt_text: string | null;
  caption: string | null;
  is_published: boolean;
};

// Every slot always has a photo: the original site image unless an editor published one.
export function defaultSitePhotos(): SitePhotos {
  const photos = {} as SitePhotos;
  for (const slot of SITE_PHOTO_SLOTS) {
    photos[slot.key] = { url: slot.defaultImage, alt: slot.defaultAlt, caption: null, isCustom: false };
  }
  return photos;
}

async function readSitePhotos(): Promise<SitePhotos> {
  const defaults = defaultSitePhotos();
  if (!isSupabaseConfigured()) return defaults;

  try {
    const supabase = await createClient();
    const result = await withPublicContentTimeout(
      supabase
        .from("site_photo_slots")
        .select("slot_key,image_path,alt_text,caption,is_published")
        .eq("is_published", true),
      null,
    );

    if (!result || result.error || !result.data) return defaults;

    const photos = { ...defaults };
    for (const row of result.data as PublishedPhotoRow[]) {
      const definition = SITE_PHOTO_SLOTS.find((slot) => slot.key === row.slot_key);
      if (!definition || !row.is_published || !row.image_path) continue;
      if (!isSitePhotoAssetPath(row.image_path, definition.key)) continue;

      photos[definition.key] = {
        url: toPublicSupabaseUrl(
          supabase.storage.from("club-public").getPublicUrl(row.image_path).data.publicUrl,
        ),
        alt: row.alt_text?.trim() || definition.defaultAlt,
        caption: row.caption?.trim() || null,
        isCustom: true,
      };
    }
    return photos;
  } catch {
    return defaults;
  }
}

// Cached for the rest of the current request, so every page section reads one result.
export const getSitePhotos = cache(readSitePhotos);
