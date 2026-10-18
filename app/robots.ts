import type { MetadataRoute } from "next";

import { getPublicSiteOrigin } from "@/utils/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/plataforma", "/auth", "/api"],
    },
    sitemap: `${getPublicSiteOrigin()}/sitemap.xml`,
  };
}
