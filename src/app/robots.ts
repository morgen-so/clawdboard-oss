export const dynamic = "force-dynamic";
import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/stats", "/api/leaderboard"],
      disallow: ["/dashboard", "/auth/", "/api/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
