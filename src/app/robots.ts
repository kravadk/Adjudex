import type { MetadataRoute } from "next";

// robots.txt for PariAI. Public crawl allowed except admin routes,
// authenticated areas, and resolver / judge dev paths.
//
// Configurable via NEXT_PUBLIC_SITE_URL (defaults to https://pariai.xyz).

export default function robots(): MetadataRoute.Robots {
  const base =
    (process.env.NEXT_PUBLIC_SITE_URL ?? "https://pariai.xyz").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/portfolio",
          "/settings",
          "/judge",
          "/resolve",
          "/admin",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
