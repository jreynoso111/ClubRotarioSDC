// Catalogue of every editable photo on the public website, except the magazine:
// its photos belong to each publication. Keys, orders and sections must match the
// checks in supabase/migrations/20261018200000_site_photo_slots_all_pages.sql
// (the registry test verifies it). Shared by the server and the client: no server-only imports here.

export const SITE_PHOTO_SECTIONS = {
  home: {
    label: "Inicio",
    hint: "Portada con seis imágenes que se alternan.",
  },
  nosotros: {
    label: "Nosotros",
    hint: "Encabezado de la página y sección «La vida del club».",
  },
  eventos: {
    label: "Agenda",
    hint: "Encabezado de la agenda pública.",
  },
  revista: {
    label: "Revista",
    hint: "Encabezado de la revista. Las fotos de cada publicación se cambian dentro de Revista.",
  },
  "membership-application": {
    label: "Solicitar membresía",
    hint: "Galería de bienvenida de la solicitud de ingreso.",
  },
} as const;

export type SitePhotoSection = keyof typeof SITE_PHOTO_SECTIONS;

export const SITE_PHOTO_SECTION_KEYS = Object.keys(SITE_PHOTO_SECTIONS) as SitePhotoSection[];

export const SITE_PHOTO_SLOT_KEYS = [
  "membership-community",
  "membership-service",
  "membership-fellowship",
  "home-hero-1",
  "home-hero-2",
  "home-hero-3",
  "home-hero-4",
  "home-hero-5",
  "home-hero-6",
  "nosotros-banner",
  "nosotros-fellowship",
  "nosotros-service",
  "nosotros-group",
  "eventos-banner",
  "revista-banner",
] as const;

export type SitePhotoSlotKey = (typeof SITE_PHOTO_SLOT_KEYS)[number];

export type SitePhotoAspect = "banner" | "landscape" | "portrait";

export const SITE_PHOTO_ASPECT_LABELS: Record<SitePhotoAspect, string> = {
  banner: "Panorámica · la imagen se recorta para llenar el banner.",
  landscape: "Horizontal · la imagen se recorta para llenar el marco.",
  portrait: "Vertical · mantén a las personas en el centro del recorte.",
};

export type SitePhotoSlotDefinition = {
  key: SitePhotoSlotKey;
  order: number;
  section: SitePhotoSection;
  title: string;
  where: string;
  pageHref: string;
  defaultImage: string;
  defaultAlt: string;
  defaultCaption: string | null;
  hasCaption: boolean;
  aspect: SitePhotoAspect;
};

export type SitePhotoSlotState = {
  imagePath: string | null;
  imageUrl: string | null;
  altText: string;
  caption: string | null;
  isPublished: boolean;
  updatedAt: string | null;
};

export type SitePhotoSlot = SitePhotoSlotDefinition & SitePhotoSlotState;

const heroWhere = "Portada de inicio, dentro del marco que alterna seis imágenes.";

export const SITE_PHOTO_SLOTS: readonly SitePhotoSlotDefinition[] = [
  {
    key: "membership-community",
    order: 1,
    section: "membership-application",
    title: "El grupo completo",
    where: "Galería de bienvenida · foto grande a la izquierda.",
    pageHref: "/solicitar-membresia#membership-community",
    defaultImage: "/club-group.webp",
    defaultAlt: "Foto de grupo del club con su estandarte",
    defaultCaption: null,
    hasCaption: true,
    aspect: "portrait",
  },
  {
    key: "membership-service",
    order: 2,
    section: "membership-application",
    title: "Servicio en acción",
    where: "Galería de bienvenida · derecha, arriba.",
    pageHref: "/solicitar-membresia#membership-service",
    defaultImage: "/club-service.webp",
    defaultAlt: "Socios del club en una jornada de servicio comunitario",
    defaultCaption: null,
    hasCaption: true,
    aspect: "landscape",
  },
  {
    key: "membership-fellowship",
    order: 3,
    section: "membership-application",
    title: "Compañerismo",
    where: "Galería de bienvenida · derecha, abajo.",
    pageHref: "/solicitar-membresia#membership-fellowship",
    defaultImage: "/club-fellowship.webp",
    defaultAlt: "Socios del club compartiendo una cena de compañerismo",
    defaultCaption: null,
    hasCaption: true,
    aspect: "landscape",
  },
  {
    key: "home-hero-1",
    order: 4,
    section: "home",
    title: "Portada · imagen 1 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/alcazar-colon-illustration.png",
    defaultAlt: "Ilustración editorial del Alcázar de Colón frente a la Plaza de España en Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "home-hero-2",
    order: 5,
    section: "home",
    title: "Portada · imagen 2 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/zona-colonial-illustration.png",
    defaultAlt: "Ilustración editorial de una calle empedrada de la Ciudad Colonial de Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "home-hero-3",
    order: 6,
    section: "home",
    title: "Portada · imagen 3 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/zona-colonial-dusk.png",
    defaultAlt: "Ilustración editorial de las murallas de la Ciudad Colonial al anochecer",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "home-hero-4",
    order: 7,
    section: "home",
    title: "Portada · imagen 4 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/zona-colonial-courtyard.png",
    defaultAlt: "Ilustración editorial de un patio colonial con arcos y fuente en Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "home-hero-5",
    order: 8,
    section: "home",
    title: "Portada · imagen 5 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/zona-colonial-las-damas.png",
    defaultAlt: "Ilustración editorial de la calle Las Damas en la Ciudad Colonial de Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "home-hero-6",
    order: 9,
    section: "home",
    title: "Portada · imagen 6 de 6",
    where: heroWhere,
    pageHref: "/#inicio",
    defaultImage: "/zona-colonial-fortaleza.png",
    defaultAlt: "Ilustración editorial de la Fortaleza Ozama junto al río en Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "landscape",
  },
  {
    key: "nosotros-banner",
    order: 10,
    section: "nosotros",
    title: "Banner superior",
    where: "Encabezado de la página Nosotros, detrás del título.",
    pageHref: "/nosotros",
    defaultImage: "/alcazar-colon-illustration.png",
    defaultAlt: "Ilustración del Alcázar de Colón en la Ciudad Colonial de Santo Domingo",
    defaultCaption: null,
    hasCaption: false,
    aspect: "banner",
  },
  {
    key: "nosotros-fellowship",
    order: 11,
    section: "nosotros",
    title: "Tarjeta 1 · Compañerismo",
    where: "Sección «La vida del club» en Nosotros, tarjeta 1 de 3.",
    pageHref: "/nosotros#vida-del-club",
    defaultImage: "/club-fellowship.webp",
    defaultAlt: "Socios del club compartiendo una cena de compañerismo",
    defaultCaption: "Compañerismo · Encuentros que fortalecen la amistad entre socios.",
    hasCaption: true,
    aspect: "landscape",
  },
  {
    key: "nosotros-service",
    order: 12,
    section: "nosotros",
    title: "Tarjeta 2 · Servicio",
    where: "Sección «La vida del club» en Nosotros, tarjeta 2 de 3.",
    pageHref: "/nosotros#vida-del-club",
    defaultImage: "/club-service.webp",
    defaultAlt: "Socios del club en una jornada de servicio comunitario",
    defaultCaption: "Servicio · Proyectos que responden a necesidades reales de la comunidad.",
    hasCaption: true,
    aspect: "landscape",
  },
  {
    key: "nosotros-group",
    order: 13,
    section: "nosotros",
    title: "Tarjeta 3 · Nuestro club",
    where: "Sección «La vida del club» en Nosotros, tarjeta 3 de 3.",
    pageHref: "/nosotros#vida-del-club",
    defaultImage: "/club-group.webp",
    defaultAlt: "Foto de grupo del club con su estandarte",
    defaultCaption: "Nuestro club · Personas de acción unidas por el ideal de servir.",
    hasCaption: true,
    aspect: "landscape",
  },
  {
    key: "eventos-banner",
    order: 14,
    section: "eventos",
    title: "Banner superior",
    where: "Encabezado de la página Agenda, detrás del título.",
    pageHref: "/eventos",
    defaultImage: "/agenda-banner-illustration.webp",
    defaultAlt: "Ilustración editorial de un encuentro en una plaza de la Ciudad Colonial",
    defaultCaption: null,
    hasCaption: false,
    aspect: "banner",
  },
  {
    key: "revista-banner",
    order: 15,
    section: "revista",
    title: "Banner superior",
    where: "Encabezado de la página Revista, detrás del título.",
    pageHref: "/revista",
    defaultImage: "/revista-banner-illustration.webp",
    defaultAlt: "Ilustración editorial de una publicación sobre servicio y comunidad",
    defaultCaption: null,
    hasCaption: false,
    aspect: "banner",
  },
];

export const MAX_SITE_PHOTO_BYTES = 10 * 1024 * 1024;

const SITE_PHOTO_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isSitePhotoSlotKey(value: unknown): value is SitePhotoSlotKey {
  return typeof value === "string" && (SITE_PHOTO_SLOT_KEYS as readonly string[]).includes(value);
}

export function getSitePhotoDefinition(key: SitePhotoSlotKey): SitePhotoSlotDefinition {
  const definition = SITE_PHOTO_SLOTS.find((slot) => slot.key === key);
  if (!definition) throw new Error(`Unknown site photo slot: ${key}`);
  return definition;
}

// Storage folder for one slot. The section comes from the registry, never from the client.
export function sitePhotoAssetPrefix(key: SitePhotoSlotKey) {
  return `site-photos/${getSitePhotoDefinition(key).section}/${key}/`;
}

export function sitePhotoAssetPath(key: SitePhotoSlotKey, fileId: string, extension: string) {
  return `${sitePhotoAssetPrefix(key)}${fileId}.${extension}`;
}

export function isSitePhotoAssetPath(value: unknown, key: SitePhotoSlotKey) {
  if (typeof value !== "string") return false;
  const prefix = sitePhotoAssetPrefix(key);
  if (!value.startsWith(prefix)) return false;
  return SITE_PHOTO_FILE_PATTERN.test(value.slice(prefix.length));
}

export function isSupportedSitePhotoType(value: string) {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export function sitePhotoExtension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return null;
}

// Path a slot's link opens in the public site, without the in-page anchor.
export function sitePhotoPagePath(key: SitePhotoSlotKey) {
  return getSitePhotoDefinition(key).pageHref.split("#")[0];
}

export function emptySitePhotoSlots(): SitePhotoSlot[] {
  return SITE_PHOTO_SLOTS.map((slot) => ({
    ...slot,
    imagePath: null,
    imageUrl: null,
    altText: "",
    caption: null,
    isPublished: false,
    updatedAt: null,
  }));
}

// Groups slots by page, in the catalogue's section order. Empty pages are left out.
export function groupSitePhotoSlots<T extends { section: SitePhotoSection }>(slots: readonly T[]) {
  return SITE_PHOTO_SECTION_KEYS
    .map((section) => ({
      section,
      label: SITE_PHOTO_SECTIONS[section].label,
      hint: SITE_PHOTO_SECTIONS[section].hint,
      slots: slots.filter((slot) => slot.section === section),
    }))
    .filter((group) => group.slots.length > 0);
}
