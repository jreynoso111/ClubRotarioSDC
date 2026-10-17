import { getPublicSiteOrigin } from "../utils/site-url";

export function isAuthRequest(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(getPublicSiteOrigin()).origin || (process.env.NODE_ENV !== "production" && origin === new URL(request.url).origin);
}
const attempts = new Map<string, { count: number; expires: number }>();
export function allowRecoveryLookup(key: string, now = Date.now()) {
  for (const [id, item] of attempts) if (item.expires <= now) attempts.delete(id);
  if (!attempts.has(key) && attempts.size >= 2000) return false;
  const item = attempts.get(key) || { count: 0, expires: now + 10 * 60000 };
  attempts.set(key, item);
  return ++item.count <= (key === "global" ? 100 : 5);
}
export async function readRecoveryEmail(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length")) > 512) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let text = "", size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 512) { await reader.cancel(); return null; }
      text += decoder.decode(item.value, { stream: true });
    }
    const input = JSON.parse(text + decoder.decode());
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch { return null; }
}
