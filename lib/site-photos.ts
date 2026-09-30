export const MEMBERSHIP_PHOTO_SLOTS = [
  {
    key: "membership-community",
    order: 1,
    title: "El grupo completo",
    description: "Una foto grupal reciente del club.",
  },
  {
    key: "membership-service",
    order: 2,
    title: "Servicio en acción",
    description: "Una actividad solidaria o proyecto comunitario.",
  },
  {
    key: "membership-fellowship",
    order: 3,
    title: "Compañerismo",
    description: "Un momento social entre socios y visitantes.",
  },
] as const;

export type MembershipPhotoSlotKey = (typeof MEMBERSHIP_PHOTO_SLOTS)[number]["key"];

export type MembershipPhotoSlot = {
  key: MembershipPhotoSlotKey;
  order: number;
  title: string;
  description: string;
  imagePath: string | null;
  imageUrl: string | null;
  altText: string;
  caption: string | null;
  isPublished: boolean;
  updatedAt: string | null;
};

export const MAX_MEMBERSHIP_PHOTO_BYTES = 10 * 1024 * 1024;

export function isMembershipPhotoSlotKey(value: unknown): value is MembershipPhotoSlotKey {
  return MEMBERSHIP_PHOTO_SLOTS.some((slot) => slot.key === value);
}

export function isSupportedMembershipPhotoType(value: string) {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export function membershipPhotoExtension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return null;
}

export function isMembershipPhotoAssetPath(value: unknown, slotKey: MembershipPhotoSlotKey) {
  if (typeof value !== "string") return false;
  const prefix = `site-photos/membership-application/${slotKey}/`;
  if (!value.startsWith(prefix)) return false;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(
    value.slice(prefix.length),
  );
}

export function emptyMembershipPhotoSlots(): MembershipPhotoSlot[] {
  return MEMBERSHIP_PHOTO_SLOTS.map((slot) => ({
    ...slot,
    imagePath: null,
    imageUrl: null,
    altText: "",
    caption: null,
    isPublished: false,
    updatedAt: null,
  }));
}
