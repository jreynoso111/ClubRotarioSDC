import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One identifier per build (written by scripts/write-deployment-id.mjs before `next build`).
const deploymentIdFile = join(process.cwd(), ".deployment-id");
const deploymentId = existsSync(deploymentIdFile) ? readFileSync(deploymentIdFile, "utf8").trim() || undefined : undefined;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseImagePattern = (() => {
  if (!supabaseUrl) return null;
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== "https:") return null;
    return {
      protocol: "https" as const,
      hostname: parsedUrl.hostname,
      pathname: "/storage/v1/object/public/club-public/site-photos/**",
    };
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  deploymentId,
  env: { CLUB_DEPLOYMENT_ID: deploymentId ?? "" },
  poweredByHeader: false,
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "clubrotariosdcolonial.org" }],
      destination: "https://www.clubrotariosdcolonial.org/:path*",
      permanent: true,
    }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
        ],
      },
      {
        source: "/auth/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/plataforma/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  images: {
    remotePatterns: supabaseImagePattern ? [supabaseImagePattern] : [],
  },
  // Keep the in-app browser's loopback host eligible for Next dev resources
  // such as HMR and the dev font endpoint.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
