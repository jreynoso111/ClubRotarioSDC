// The internal transport URL must never change the browser's session namespace.
export function getAuthCookieName(publicSupabaseUrl: string) {
  return `sb-${new URL(publicSupabaseUrl).hostname.split(".")[0]}-auth-token`;
}
