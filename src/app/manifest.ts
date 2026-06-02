import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Adjudex",
    short_name: "Adjudex",
    description:
      "AI-native prediction markets with real contracts, indexed proof, and portfolio lifecycle.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#d9ff00",
    orientation: "portrait-primary",
    categories: ["finance", "sports", "productivity"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Markets",
        short_name: "Markets",
        description: "Open indexed live markets.",
        url: "/",
      },
      {
        name: "Portfolio",
        short_name: "Portfolio",
        description: "Track positions and claimable payouts.",
        url: "/portfolio",
      },
      {
        name: "Create",
        short_name: "Create",
        description: "Open the market creator studio.",
        url: "/create",
      },
    ],
  };
}
