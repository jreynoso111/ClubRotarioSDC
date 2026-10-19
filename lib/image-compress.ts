// Browser-side optimization for photo uploads. Phone pictures are decoded (respecting their EXIF
// rotation), scaled down and re-encoded as WebP so the stored file stays small. The pure helpers
// below are shared with the tests; browser APIs are only touched inside the functions that need them.

const KB = 1024;
const MB = 1024 * KB;

export const MAX_INPUT_IMAGE_BYTES = 60 * MB;

export const imagePresets = {
  sitePhoto: { maxDimension: 2400, maxBytes: 1.5 * MB },
  storyImage: { maxDimension: 2400, maxBytes: 1.5 * MB },
  receiptImage: { maxDimension: 2000, maxBytes: 1.5 * MB },
} as const;

// Each round shrinks the picture by COMPRESSION_SCALE_STEP and tries the qualities from best to smallest.
export const COMPRESSION_QUALITIES = [0.86, 0.8, 0.72, 0.64, 0.56] as const;
export const COMPRESSION_SCALE_STEP = 0.85;
export const COMPRESSION_MAX_ROUNDS = 6;

// A file that already fits the limits is only re-encoded when that saves at least 15%.
const MIN_SAVING_RATIO = 0.85;
const KEPT_AS_IS_TYPES = ["image/jpeg", "image/png", "image/webp"];
// HEIC, AVIF and GIF are attempted too: browsers that can decode them succeed, the others report the error.
// An empty type (some systems do not label HEIC files) is also attempted.
const READABLE_TYPES = [...KEPT_AS_IS_TYPES, "image/heic", "image/heif", "image/avif", "image/gif", ""];

const TOO_LARGE_MESSAGE = "La foto es demasiado grande (máximo 60 MB).";
const UNREADABLE_MESSAGE = "No pudimos leer esta imagen. Usa una foto JPG, PNG o WebP.";
const UNSUPPORTED_BROWSER_MESSAGE = "Tu navegador no pudo preparar la foto. Prueba con otra imagen.";

export type CompressOptions = { maxDimension: number; maxBytes: number; fileName?: string };
export type CompressedImage = { file: File; originalBytes: number; finalBytes: number; width: number; height: number };

// Scales the picture down so its longest side fits maxDimension. Never upscales; keeps the aspect ratio.
export function fitWithin(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (!(width > 0 && height > 0 && maxDimension > 0)) throw new RangeError("Las dimensiones de la imagen no son válidas.");
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const ratio = maxDimension / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

// The encoder rounds, from the full size to the smallest allowed size, with the qualities of each round.
export function compressionSchedule(): { scale: number; qualities: readonly number[] }[] {
  return Array.from({ length: COMPRESSION_MAX_ROUNDS }, (_, round) => ({
    scale: COMPRESSION_SCALE_STEP ** round,
    qualities: COMPRESSION_QUALITIES,
  }));
}

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
  const base = fileName.replace(/\.[^./\\]+$/, "").trim();
  return base || "foto";
}

function scaleDimension(value: number, scale: number) {
  return Math.max(1, Math.round(value * scale));
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; release: () => void };

// Prefers createImageBitmap, which applies the EXIF orientation. Falls back to an <img> element.
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      }
      bitmap.close();
    } catch {
      // Some browsers reject the option or the format; the <img> path below decides.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    }
  } catch {
    // Reported below as an unreadable picture.
  }
  URL.revokeObjectURL(url);
  throw new Error(UNREADABLE_MESSAGE);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("La imagen no se pudo cargar."));
    image.src = url;
  });
}

type Surface = {
  draw(source: CanvasImageSource, fillWhite: boolean): void;
  encode(type: string, quality: number): Promise<Blob | null>;
};

// OffscreenCanvas when available, otherwise a detached <canvas>. JPEG has no transparency, so it gets a white background.
function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error(UNSUPPORTED_BROWSER_MESSAGE);
    return {
      draw(source, fillWhite) {
        if (fillWhite) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
        }
        context.imageSmoothingQuality = "high";
        context.drawImage(source, 0, 0, width, height);
      },
      encode: (type, quality) => canvas.convertToBlob({ type, quality }),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(UNSUPPORTED_BROWSER_MESSAGE);
  return {
    draw(source, fillWhite) {
      if (fillWhite) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, height);
    },
    encode: (type, quality) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality)),
  };
}

// Some browsers (notably Safari) cannot encode WebP in a canvas. They get JPEG instead, checked once.
let webpEncoding: Promise<boolean> | null = null;

function canEncodeWebp(): Promise<boolean> {
  if (!webpEncoding) {
    webpEncoding = Promise.resolve()
      .then(() => createSurface(1, 1).encode("image/webp", 0.8))
      .then(blob => blob?.type === "image/webp")
      .catch(() => false);
  }
  return webpEncoding;
}

async function encodeWithinBudget(source: CanvasImageSource, fit: { width: number; height: number }, outputType: string, maxBytes: number) {
  for (const round of compressionSchedule()) {
    const width = scaleDimension(fit.width, round.scale);
    const height = scaleDimension(fit.height, round.scale);
    const surface = createSurface(width, height);
    surface.draw(source, outputType === "image/jpeg");
    for (const quality of round.qualities) {
      const blob = await surface.encode(outputType, quality);
      if (blob && blob.type === outputType && blob.size <= maxBytes) return { blob, width, height };
    }
  }
  return null;
}

// Returns a File that is at most maxBytes and whose longest side is at most maxDimension.
// When the input already fits and re-encoding does not save 15%, the original file is returned unchanged.
export async function compressImage(file: File, options: CompressOptions): Promise<CompressedImage> {
  const { maxDimension, maxBytes } = options;
  if (!(maxDimension > 0 && maxBytes > 0)) throw new RangeError("Los límites de optimización no son válidos.");
  if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error(TOO_LARGE_MESSAGE);
  if (!READABLE_TYPES.includes(file.type)) throw new Error(UNREADABLE_MESSAGE);

  const decoded = await decodeImage(file);
  try {
    const fit = fitWithin(decoded.width, decoded.height, maxDimension);
    const needsScaling = fit.width !== decoded.width || fit.height !== decoded.height;
    const keepIfSmaller = !needsScaling && file.size <= maxBytes && KEPT_AS_IS_TYPES.includes(file.type);
    const unchanged: CompressedImage = { file, originalBytes: file.size, finalBytes: file.size, width: decoded.width, height: decoded.height };

    const outputType = (await canEncodeWebp()) ? "image/webp" : "image/jpeg";
    const encoded = await encodeWithinBudget(decoded.source, fit, outputType, maxBytes);
    if (!encoded) {
      if (keepIfSmaller) return unchanged;
      throw new Error(`No pudimos reducir esta foto a ${formatBytes(maxBytes)}. Prueba con otra imagen.`);
    }
    if (keepIfSmaller && encoded.blob.size > file.size * MIN_SAVING_RATIO) return unchanged;

    const extension = outputType === "image/webp" ? "webp" : "jpg";
    const optimized = new File([encoded.blob], `${baseNameOf(options.fileName ?? file.name)}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
    return { file: optimized, originalBytes: file.size, finalBytes: optimized.size, width: encoded.width, height: encoded.height };
  } finally {
    decoded.release();
  }
}
