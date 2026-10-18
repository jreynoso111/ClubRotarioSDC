"use client";

import { avatarOutputSize, centeredSquare } from "@/lib/account";

// Crops the picture to its centered square and re-encodes it as a 512 x 512 WebP.
// The browser decodes the file, so the stored object never carries the original metadata.
export async function prepareAvatarImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No pudimos leer la foto. Usa otra imagen JPG, PNG o WebP.");
  }
  try {
    const { x, y, side } = centeredSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = avatarOutputSize;
    canvas.height = avatarOutputSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Tu navegador no pudo preparar la foto. Prueba con otra imagen.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, x, y, side, side, 0, 0, avatarOutputSize, avatarOutputSize);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob || blob.type !== "image/webp") throw new Error("Tu navegador no pudo preparar la foto. Prueba con otra imagen.");
    return blob;
  } finally {
    bitmap.close();
  }
}
