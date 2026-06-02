import type { MetadataRoute } from "next";

// robots.txt for Adjudex. Public crawl allowed except admin routes,
// authenticated areas, and resolver / judge dev paths.
//
// Configurable via NEXT_PUBLIC_SITE_URL (defaults to https://adjudex.xyz).

export default function robots(): MetadataRoute.Robots {
  const base =
    (process.env.NEXT_PUBLIC_SITE_URL ?? "https://adjudex.xyz").replace(/\/$/, "");
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
