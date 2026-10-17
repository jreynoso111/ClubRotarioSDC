export function getPublicSiteOrigin() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://www.clubrotariosdcolonial.org"
  ).replace(/\/+$/, "");
}
