import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the in-app browser's loopback host eligible for Next dev resources
  // such as HMR and the dev font endpoint.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
