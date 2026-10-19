// Shared rules for "Mi cuenta". Pure module: no server or browser imports, so the
// browser forms, the server actions, the avatar route and the tests read one copy.

export const accountNameRange = { min: 2, max: 120 } as const;
export const accountBioMaxLength = 600;
export const passwordMinLength = 8;
export const passwordMaxBytes = 72;
export const avatarBucket = "club-media";
export const avatarAcceptedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
// Limit for the stored avatar object (512 x 512 WebP). The picture picked by the user may be much larger:
// the browser crops and re-encodes it before upload, so only the stored size is checked on the server.
export const avatarMaxBytes = 5 * 1024 * 1024;
export const avatarOutputSize = 512;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const avatarSuffix = ".webp";

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

export function isLowercaseUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

// Avatars live under the owner's folder as <uid>/avatar-<uuid>.webp.
export function avatarPathFor(userId: string, uuid: string) {
  return `${userId}/avatar-${uuid}.webp`;
}

export function isOwnAvatarPath(userId: unknown, path: unknown): path is string {
  if (!isLowercaseUuid(userId) || typeof path !== "string") return false;
  const prefix = `${userId}/avatar-`;
  if (!path.startsWith(prefix) || !path.endsWith(avatarSuffix)) return false;
  return isLowercaseUuid(path.slice(prefix.length, path.length - avatarSuffix.length));
}

// The object name inside the owner's folder, e.g. avatar-<uuid>.webp.
export function avatarObjectName(userId: string, path: string) {
  return path.slice(userId.length + 1);
}

// Cache-busting version: the profile's update time, only when a photo exists.
export function avatarVersion(avatarPath: string | null | undefined, updatedAt: string | null | undefined) {
  return avatarPath && updatedAt ? updatedAt : null;
}

export function avatarRouteUrl(userId: string, version: string) {
  return `/plataforma/avatar/${userId}?v=${encodeURIComponent(version)}`;
}

export function initialsFor(name: string) {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("");
  return letters.toLocaleUpperCase("es") || "?";
}

// Square crop taken from the center of the picture.
export function centeredSquare(width: number, height: number) {
  if (!(width > 0 && height > 0)) throw new Error("La imagen no tiene un tamaño válido.");
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export function validateDisplayName(value: unknown): Validation<string> {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < accountNameRange.min || name.length > accountNameRange.max) {
    return { ok: false, message: `Escribe tu nombre de ${accountNameRange.min} a ${accountNameRange.max} caracteres.` };
  }
  return { ok: true, value: name };
}

export function validateBio(value: unknown): Validation<string> {
  if (value !== undefined && value !== null && typeof value !== "string") return { ok: false, message: "La biografía no es válida." };
  const bio = typeof value === "string" ? value.trim() : "";
  if (bio.length > accountBioMaxLength) return { ok: false, message: `La biografía no puede superar los ${accountBioMaxLength} caracteres.` };
  return { ok: true, value: bio };
}

export function validateEmailAddress(value: unknown, currentEmail: string): Validation<string> {
  if (typeof value !== "string") return { ok: false, message: "Escribe el nuevo correo electrónico." };
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) return { ok: false, message: "Escribe un correo electrónico válido." };
  if (email === currentEmail.trim().toLowerCase()) return { ok: false, message: "Ese ya es tu correo actual." };
  return { ok: true, value: email };
}

export function validateReauthCode(value: unknown): Validation<string> {
  const code = typeof value === "string" ? value.trim() : "";
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Escribe el código de 6 dígitos que te enviamos." };
  return { ok: true, value: code };
}

export function validateNewPassword(password: unknown, confirmation: unknown): Validation<string> {
  if (typeof password !== "string" || typeof confirmation !== "string") {
    return { ok: false, message: "Escribe la nueva contraseña y repítela." };
  }
  if (password.length < passwordMinLength) return { ok: false, message: "La contraseña debe tener al menos 8 caracteres." };
  if (new TextEncoder().encode(password).length > passwordMaxBytes) {
    return { ok: false, message: "La contraseña es demasiado larga. Usa menos caracteres." };
  }
  if (password !== confirmation) return { ok: false, message: "Las contraseñas no coinciden." };
  return { ok: true, value: password };
}
