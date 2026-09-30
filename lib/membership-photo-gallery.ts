import "server-only";

import { withPublicContentTimeout } from "@/lib/supabase/timeout";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";
import {
  emptyMembershipPhotoSlots,
  MEMBERSHIP_PHOTO_SLOTS,
  type MembershipPhotoSlot,
  type MembershipPhotoSlotKey,
} from "./site-photos";

type MembershipPhotoRow = {
  slot_key: MembershipPhotoSlotKey;
  image_path: string | null;
  alt_text: string;
  caption: string | null;
  is_published: boolean;
};

export async function getPublishedMembershipPhotoSlots(): Promise<MembershipPhotoSlot[]> {
  const placeholders = emptyMembershipPhotoSlots();
  if (!isSupabaseConfigured()) return placeholders;

  try {
    const supabase = await createClient();
    const result = await withPublicContentTimeout(
      supabase
        .from("site_photo_slots")
        .select("slot_key,image_path,alt_text,caption,is_published")
        .eq("is_published", true),
      null,
    );

    if (!result || result.error || !result.data) return placeholders;

    const publishedRows = result.data as MembershipPhotoRow[];
    return MEMBERSHIP_PHOTO_SLOTS.map((definition) => {
      const row = publishedRows.find((photo) => photo.slot_key === definition.key);
      if (!row?.image_path) return placeholders.find((slot) => slot.key === definition.key)!;

      return {
        ...definition,
        imagePath: row.image_path,
        imageUrl: supabase.storage.from("club-public").getPublicUrl(row.image_path).data.publicUrl,
        altText: row.alt_text,
        caption: row.caption,
        isPublished: true,
        updatedAt: null,
      };
    });
  } catch {
    return placeholders;
  }
}
