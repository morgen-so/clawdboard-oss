export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { users, teams } from "@/lib/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { routing } from "@/i18n/routing";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

/** Build locale URL respecting localePrefix: "as-needed" (no prefix for en) */
function localeUrl(loc: string, path: string) {
  return loc === "en" ? `${BASE_URL}${path}` : `${BASE_URL}/${loc}${path}`;
}

/** Build alternates.languages object for a given path */
function localeAlternates(path: string) {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = localeUrl(loc, path);
  }
  languages["x-default"] = localeUrl("en", path);
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [allUsers, publicTeams] = await Promise.all([
    db
      .select({ githubUsername: users.githubUsername })
      .from(users)
      .where(isNotNull(users.githubUsername)),
    db
      .select({ slug: teams.slug })
      .from(teams)
      .where(and(eq(teams.isPublic, true), isNull(teams.deletedAt))),
  ]);

  const staticPages: {
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }[] = [
    { path: "/", changeFrequency: "hourly", priority: 1.0 },
    { path: "/teams", changeFrequency: "hourly", priority: 0.8 },
    { path: "/log", changeFrequency: "weekly", priority: 0.6 },
    { path: "/faq", changeFrequency: "monthly", priority: 0.4 },
    { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
    { path: "/terms", changeFrequency: "monthly", priority: 0.3 },
  ];

  const entries: MetadataRoute.Sitemap = [];

  // Static pages with locale alternates
  for (const page of staticPages) {
    entries.push({
      url: localeUrl("en", page.path),
      lastModified: now,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      alternates: localeAlternates(page.path),
    });
  }

  // User profile pages
  for (const u of allUsers) {
    if (!u.githubUsername) continue;
    const path = `/user/${u.githubUsername}`;
    entries.push({
      url: localeUrl("en", path),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
      alternates: localeAlternates(path),
    });
  }

  // Team pages
  for (const t of publicTeams) {
    const path = `/team/${t.slug}`;
    entries.push({
      url: localeUrl("en", path),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
      alternates: localeAlternates(path),
    });
  }

  return entries;
}
