export const editorialLayouts = [
  {
    id: "portada",
    name: "Portada",
    description: "Titular y bajada primero; fotografía amplia y una cita dentro de la crónica.",
    map: ["TITULAR + BAJADA", "FOTOGRAFÍA PRINCIPAL", "TEXTO + CITA"],
  },
  {
    id: "cronica-visual",
    name: "Crónica visual",
    description: "Titular a la izquierda, fotografía principal a la derecha y una imagen de apoyo entre párrafos.",
    map: ["TITULAR", "FOTO PRINCIPAL →", "TEXTO · FOTO DE APOYO"],
  },
  {
    id: "voces",
    name: "Voces",
    description: "Una cita destacada abre la lectura; la imagen de apoyo cierra la historia.",
    map: ["CITA DESTACADA", "TITULAR + BAJADA", "FOTO PRINCIPAL · TEXTO"],
  },
] as const;

export type EditorialLayoutId = (typeof editorialLayouts)[number]["id"];

export type EditorialArticleContent = {
  layoutId: EditorialLayoutId;
  body: string;
  pullQuote: string;
  inlineImagePath: string | null;
  inlineImageAlt: string;
  inlineImageCaption: string;
  coverImageAlt: string;
};

type SerializedEditorialContent = EditorialArticleContent & {
  format: "club-editorial";
  version: 1;
};

const layoutIds = new Set<string>(editorialLayouts.map((layout) => layout.id));
const storyAssetPathPattern = /^stories\/[a-f0-9-]{36}-(?:cover|inline)\.(?:jpe?g|png|webp)$/i;

export function isStoryAssetPath(value: string | null | undefined): value is string {
  return typeof value === "string" && storyAssetPathPattern.test(value);
}

export function serializeEditorialContent(value: EditorialArticleContent): string {
  return JSON.stringify({
    format: "club-editorial",
    version: 1,
    layoutId: value.layoutId,
    body: value.body.trim(),
    pullQuote: value.pullQuote.trim(),
    inlineImagePath: value.inlineImagePath,
    inlineImageAlt: value.inlineImageAlt.trim(),
    inlineImageCaption: value.inlineImageCaption.trim(),
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
  const document = parsed as Partial<SerializedEditorialContent>;
  if (document.format !== "club-editorial" || document.version !== 1) return null;
  if (typeof document.layoutId !== "string" || !layoutIds.has(document.layoutId)) return null;
  if (typeof document.body !== "string" || document.body.trim().length === 0 || document.body.length > 18_000) return null;
  if (typeof document.pullQuote !== "string" || document.pullQuote.length > 500) return null;
  if (document.inlineImagePath !== null && typeof document.inlineImagePath !== "string") return null;
  if (document.inlineImagePath && !isStoryAssetPath(document.inlineImagePath)) return null;
  if (typeof document.inlineImageAlt !== "string" || document.inlineImageAlt.length > 250) return null;
  if (typeof document.inlineImageCaption !== "string" || document.inlineImageCaption.length > 300) return null;
  if (typeof document.coverImageAlt !== "string" || document.coverImageAlt.length > 250) return null;

  return {
    layoutId: document.layoutId as EditorialLayoutId,
    body: document.body.trim(),
    pullQuote: document.pullQuote.trim(),
    inlineImagePath: document.inlineImagePath,
    inlineImageAlt: document.inlineImageAlt.trim(),
    inlineImageCaption: document.inlineImageCaption.trim(),
    coverImageAlt: document.coverImageAlt.trim(),
  };
}
