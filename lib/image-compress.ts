// Browser-side optimization for photo uploads, done by the open-source library
// browser-image-compression (MIT): it reads the EXIF rotation, scales the picture down and
// re-encodes it as WebP so the stored file stays small. Only the size texts are ours.
import imageCompression from "browser-image-compression";

const KB = 1024;
const MB = 1024 * KB;

export const MAX_INPUT_IMAGE_BYTES = 60 * MB;

export const imagePresets = {
  sitePhoto: { maxDimension: 2400, maxBytes: 1.5 * MB },
  storyImage: { maxDimension: 2400, maxBytes: 1.5 * MB },
  receiptImage: { maxDimension: 2000, maxBytes: 1.5 * MB },
} as const;

const TOO_LARGE_MESSAGE = "La foto es demasiado grande (máximo 60 MB).";
const UNREADABLE_MESSAGE = "No pudimos leer esta imagen. Usa una foto JPG, PNG o WebP.";

export type CompressOptions = { maxDimension: number; maxBytes: number; fileName?: string };
export type CompressedImage = { file: File; originalBytes: number; finalBytes: number };

// Spanish sizes: "640 KB" below one megabyte, then "12,3 MB".
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("El tamaño del archivo no es válido.");
  const kilobytes = Math.round(bytes / KB);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  const fixed = (bytes / MB).toFixed(1);
  const text = fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed.replace(".", ",");
  return `${text} MB`;
}

// Short note for the user, or null when the file did not get smaller.
export function optimizationNote(result: { originalBytes: number; finalBytes: number }): string | null {
  if (result.finalBytes >= result.originalBytes) return null;
  return `Foto optimizada: ${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}`;
}

function baseNameOf(fileName: string) {
  return fileName.replace(/\.[^./\\]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "foto";
}

export async function compressImage(file: File, options: CompressOptions): Promise<CompressedImage> {
  if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error(TOO_LARGE_MESSAGE);
  let compressed: Blob;
  try {
    // The web worker would load the library from a CDN, which the site's CSP blocks.
    compressed = await imageCompression(file, {
      maxSizeMB: options.maxBytes / MB,
      maxWidthOrHeight: options.maxDimension,
      fileType: "image/webp",
      initialQuality: 0.86,
      useWebWorker: false,
    });
  } catch {
    throw new Error(UNREADABLE_MESSAGE);
  }
  // Keep the original when it is already small enough and the library could not improve it.
  if (compressed.size >= file.size && file.size <= options.maxBytes && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { file, originalBytes: file.size, finalBytes: file.size };
  }
  const optimized = new File([compressed], `${baseNameOf(options.fileName ?? file.name)}.webp`, { type: "image/webp", lastModified: Date.now() });
  return { file: optimized, originalBytes: file.size, finalBytes: optimized.size };
}
