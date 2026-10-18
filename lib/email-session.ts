export function readEmailSession(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  if (!accessToken || !refreshToken || params.has("error") || (type !== "recovery" && type !== "signup" && type !== "email_change")) return null;
  return {
    accessToken,
    refreshToken,
    destination: type === "recovery" ? "/auth/reset-password" : type === "email_change" ? "/plataforma?tab=perfil" : "/auth/sign-in?notice=confirmed",
  };
}

// With secure email change, the first of the two links only confirms one address:
// Auth returns a message and no session until the other address is confirmed too.
export function isPendingEmailChange(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  return !params.has("error") && !params.has("access_token") && Boolean(params.get("message"));
}
