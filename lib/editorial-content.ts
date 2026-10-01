export const editorialLayouts = [
  {
    id: "portada",
    name: "Portada",
    description: "Titular y resumen primero; fotografía amplia y una cita dentro de la crónica.",
    map: ["TITULAR + RESUMEN", "FOTOGRAFÍA PRINCIPAL", "TEXTO + CITA"],
  },
  {
    id: "cronica-visual",
    name: "Crónica visual",
    description: "Titular a la izquierda y fotografía principal a la derecha; texto, cita y fotos a continuación.",
    map: ["TITULAR", "FOTO PRINCIPAL →", "TEXTO · FOTO DE APOYO"],
  },
  {
    id: "voces",
    name: "Voces",
    description: "Una cita destacada abre la lectura, seguida del titular, fotografía principal y texto.",
    map: ["CITA DESTACADA", "TITULAR + RESUMEN", "FOTO PRINCIPAL · TEXTO"],
  },
] as const;

export type EditorialLayoutId = (typeof editorialLayouts)[number]["id"];
export type EditorialImageAlignment = "left" | "right" | "wide";
export const MAX_EDITORIAL_GALLERY_IMAGES = 12;
export const MAX_EDITORIAL_CONTENT_LENGTH = 30_000;

export type EditorialGalleryImage = {
  path: string;
  alt: string;
  caption: string;
};

export type EditorialArticleContent = {
  layoutId: EditorialLayoutId;
  body: string;
  pullQuote: string;
  inlineImagePath: string | null;
  inlineImageAlt: string;
  inlineImageCaption: string;
  inlineImageAfterParagraph: number;
  inlineImageAlignment: EditorialImageAlignment;
  gallery: EditorialGalleryImage[];
  coverImageAlt: string;
};

type SerializedEditorialContent = EditorialArticleContent & {
  format: "club-editorial";
  version: 2;
};
type EditorialContentInput = Omit<EditorialArticleContent, "inlineImageAfterParagraph" | "inlineImageAlignment" | "gallery"> &
  Partial<Pick<EditorialArticleContent, "inlineImageAfterParagraph" | "inlineImageAlignment" | "gallery">>;

const layoutIds = new Set<string>(editorialLayouts.map((layout) => layout.id));
const storyAssetPathPattern = /^stories\/[a-f0-9-]{36}-(?:cover|inline|gallery)\.(?:jpe?g|png|webp)$/i;

export function isStoryAssetPath(value: string | null | undefined): value is string {
  return typeof value === "string" && storyAssetPathPattern.test(value);
}

export function serializeEditorialContent(value: EditorialContentInput): string {
  return JSON.stringify({
    format: "club-editorial",
    version: 2,
    layoutId: value.layoutId,
    body: value.body.trim(),
    pullQuote: value.pullQuote.trim(),
    inlineImagePath: value.inlineImagePath,
    inlineImageAlt: value.inlineImageAlt.trim(),
    inlineImageCaption: value.inlineImageCaption.trim(),
    inlineImageAfterParagraph: value.inlineImageAfterParagraph ?? -1,
    inlineImageAlignment: value.inlineImageAlignment ?? "wide",
    gallery: (value.gallery ?? []).map((image) => ({
      path: image.path,
      alt: image.alt.trim(),
      caption: image.caption.trim(),
    })),
    coverImageAlt: value.coverImageAlt.trim(),
  } satisfies SerializedEditorialContent);
}

export function parseEditorialContent(content: string): EditorialArticleContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const document = parsed as Partial<EditorialArticleContent> & { format?: unknown; version?: unknown };
  if (document.format !== "club-editorial" || (document.version !== 1 && document.version !== 2)) return null;
  if (typeof document.layoutId !== "string" || !layoutIds.has(document.layoutId)) return null;
  if (typeof document.body !== "string" || document.body.trim().length === 0 || document.body.length > 18_000) return null;
  if (typeof document.pullQuote !== "string" || document.pullQuote.length > 500) return null;
  if (document.inlineImagePath !== null && typeof document.inlineImagePath !== "string") return null;
  if (document.inlineImagePath && !isStoryAssetPath(document.inlineImagePath)) return null;
  if (typeof document.inlineImageAlt !== "string" || document.inlineImageAlt.length > 250) return null;
  if (typeof document.inlineImageCaption !== "string" || document.inlineImageCaption.length > 300) return null;
  const inlineImageAfterParagraph = document.version === 1 ? -1 : document.inlineImageAfterParagraph;
  if (typeof inlineImageAfterParagraph !== "number") return null;
  if (!Number.isInteger(inlineImageAfterParagraph) || inlineImageAfterParagraph < -1 || inlineImageAfterParagraph > 1000) return null;
  const inlineImageAlignment = document.version === 1 ? "wide" : document.inlineImageAlignment;
  if (inlineImageAlignment !== "left" && inlineImageAlignment !== "right" && inlineImageAlignment !== "wide") return null;

  const gallery = document.version === 1 ? [] : parseGallery(document.gallery);
  if (!gallery) return null;
  if (typeof document.coverImageAlt !== "string" || document.coverImageAlt.length > 250) return null;

  return {
    layoutId: document.layoutId as EditorialLayoutId,
    body: document.body.trim(),
    pullQuote: document.pullQuote.trim(),
    inlineImagePath: document.inlineImagePath,
    inlineImageAlt: document.inlineImageAlt.trim(),
    inlineImageCaption: document.inlineImageCaption.trim(),
    inlineImageAfterParagraph,
    inlineImageAlignment,
    gallery,
    coverImageAlt: document.coverImageAlt.trim(),
  };
}

function parseGallery(value: unknown): EditorialGalleryImage[] | null {
  if (!Array.isArray(value) || value.length > MAX_EDITORIAL_GALLERY_IMAGES) return null;

  const gallery: EditorialGalleryImage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const image = item as Partial<EditorialGalleryImage>;
    if (
      typeof image.path !== "string" ||
      !isStoryAssetPath(image.path) ||
      typeof image.alt !== "string" ||
      image.alt.trim().length === 0 || image.alt.length > 250 ||
      typeof image.caption !== "string" ||
      image.caption.length > 300
    ) return null;
    if (gallery.some((previous) => previous.path === image.path)) return null;
    gallery.push({ path: image.path, alt: image.alt.trim(), caption: image.caption.trim() });
  }

  return gallery;
}

export function splitEditorialParagraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function getInlineImageInsertionIndex(editorial: Pick<EditorialArticleContent, "layoutId" | "inlineImageAfterParagraph">, paragraphCount: number): number {
  if (editorial.inlineImageAfterParagraph === -1) {
    return editorial.layoutId === "cronica-visual" ? Math.max(1, Math.ceil(paragraphCount / 2)) : paragraphCount;
  }
  return Math.min(Math.max(0, editorial.inlineImageAfterParagraph), paragraphCount);
}
