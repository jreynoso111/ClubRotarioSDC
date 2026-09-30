import type { NextConfig } from "next";

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
  images: {
    remotePatterns: supabaseImagePattern ? [supabaseImagePattern] : [],
  },
  // Keep the in-app browser's loopback host eligible for Next dev resources
  // such as HMR and the dev font endpoint.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
