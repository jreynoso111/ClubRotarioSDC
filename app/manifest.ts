import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Club Rotario Santo Domingo Colonial",
    short_name: "Club Rotario SDQ",
    description:
      "Personas de acción que conectan experiencia, tiempo y aliados para servir a Santo Domingo Colonial.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f1e9",
    theme_color: "#17458f",
    icons: [
      {
        src: "/rotary-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/rotary-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
