import "server-only";

export function toPublicSupabaseUrl(url: string) {
  const internalBase = process.env.SUPABASE_SERVER_URL?.trim().replace(/\/+$/, "");
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");

  if (!internalBase || !publicBase || internalBase === publicBase) return url;
  if (!url.startsWith(`${internalBase}/`)) return url;

  return `${publicBase}${url.slice(internalBase.length)}`;
}
