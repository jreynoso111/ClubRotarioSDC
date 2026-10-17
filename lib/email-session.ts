export function readEmailSession(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  if (!accessToken || !refreshToken || params.has("error") || (type !== "recovery" && type !== "signup")) return null;
  return {
    accessToken,
    refreshToken,
    destination: type === "recovery" ? "/auth/reset-password" : "/auth/sign-in?notice=confirmed",
  };
}
