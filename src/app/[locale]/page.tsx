export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { cachedAuth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import {
  getLeaderboardData,
  getUserLeaderboardRow,
  getVibeCoderCount,
  VALID_PERIODS,
  VALID_SORTS,
  VALID_ORDERS,
  parseDateRange,
  type Period,
  type SortCol,
  type SortOrder,
} from "@/lib/db/cached";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { LeaderboardToggle } from "@/components/leaderboard/LeaderboardToggle";
import { TimeFilter } from "@/components/leaderboard/TimeFilter";
import { JoinBanner } from "@/components/leaderboard/JoinBanner";
import { SyncBanner } from "@/components/leaderboard/SyncBanner";
import { SyncCountdown } from "@/components/leaderboard/SyncCountdown";
import { YourPosition } from "@/components/leaderboard/YourPosition";
import { BadgePrompt } from "@/components/leaderboard/BadgePrompt";
import { RecapBanner } from "@/components/recaps/RecapBanner";
import { SignInButton } from "@/components/auth/SignInButton";
import { UserNav } from "@/components/auth/UserNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Header } from "@/components/layout/Header";
import { cookies } from "next/headers";
import { PERIOD_COOKIE, parsePeriodCookie } from "@/lib/period-cookie";

export const metadata: Metadata = {
  title: "clawdboard — AI Coding Usage Leaderboard",
  description:
    "See who's spending the most on AI coding. Compare usage, costs, streaks, and model breakdowns across developers on the free community leaderboard.",
  alternates: { canonical: env.NEXT_PUBLIC_BASE_URL },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "clawdboard",
  description:
    "Leaderboard for tracking and comparing AI coding usage across developers.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  url: env.NEXT_PUBLIC_BASE_URL,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

function buildItemListLd(rows: { githubUsername: string | null; totalCost: string; rank: number }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AI Coding Usage Leaderboard",
    description: "Top developers ranked by AI coding usage and estimated cost.",
    numberOfItems: rows.length,
    itemListElement: rows
      .filter((r) => r.githubUsername)
      .slice(0, 20)
      .map((r) => ({
        "@type": "ListItem",
        position: r.rank,
        name: r.githubUsername,
        url: `${env.NEXT_PUBLIC_BASE_URL}/user/${r.githubUsername}`,
      })),
  };
}

interface PageProps {
  searchParams: Promise<{ period?: string; sort?: string; order?: string; from?: string; to?: string }>;
}


export default async function LeaderboardPage({ searchParams }: PageProps) {
  const t = await getTranslations("leaderboard");
  const params = await searchParams;
  const saved = parsePeriodCookie((await cookies()).get(PERIOD_COOKIE)?.value);

  // Validate searchParams with defaults (fall back to cookie, then "7d")
  const period: Period = VALID_PERIODS.includes(params.period as Period)
    ? (params.period as Period)
    : saved?.period ?? "7d";
  const sort: SortCol = VALID_SORTS.includes(params.sort as SortCol)
    ? (params.sort as SortCol)
    : "cost";
  const order: SortOrder = VALID_ORDERS.includes(params.order as SortOrder)
    ? (params.order as SortOrder)
    : "desc";

  const range = period === "custom"
    ? parseDateRange(params.from ?? saved?.from, params.to ?? saved?.to)
    : undefined;

  const [{ rows, totalCount }, session, vibeCoderCount] = await Promise.all([
    getLeaderboardData(period, sort, order, range),
    cachedAuth(),
    getVibeCoderCount(),
  ]);

  // Only query for authenticated users (simple indexed lookups)
  let hasSynced = false;
  let lastSyncAt: Date | null = null;
  let syncIntervalMs: number | null = null;
  let badgePromptDismissed = false;

  if (session?.user?.id) {
    const [user] = await db
      .select({
        lastSyncAt: users.lastSyncAt,
        syncIntervalMs: users.syncIntervalMs,
        badgePromptDismissedAt: users.badgePromptDismissedAt,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    hasSynced = user?.lastSyncAt !== null;
    lastSyncAt = user?.lastSyncAt ?? null;
    syncIntervalMs = user?.syncIntervalMs ?? null;
    badgePromptDismissed = user?.badgePromptDismissedAt !== null;
  }

  const displayName = session?.user?.githubUsername ?? session?.user?.name ?? "user";

  // Find the current user's row — try the loaded page first, fall back to a
  // dedicated query for users ranked beyond the initial 100.
  const myRow = session?.user?.id
    ? (rows.find(r => r.userId === session.user!.id)
       ?? await getUserLeaderboardRow(session.user!.id, period, sort, order, range)
       ?? undefined)
    : undefined;

  return (
    <div className="relative min-h-screen bg-background">
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListLd(rows)) }}
      />


      {/* Recap banner — full-width above header for logged-in users with unseen recaps */}
      {session?.user && hasSynced && <RecapBanner />}

      {/* Sync banner — full-width above header for logged-in users without data */}
      {session?.user && !hasSynced && (
        <SyncBanner username={displayName} />
      )}

      {/* Header */}
      <Header
        linkHome={false}
        subtitle="claude code leaderboard"
        rightContent={
          session?.user ? (
            <>
              <NotificationBell />
              <UserNav
                name={displayName}
                image={session.user.image}
              />
            </>
          ) : (
            <SignInButton />
          )
        }
      />

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Join banner for unauthenticated users */}
        {!session?.user && <JoinBanner vibeCoderCount={vibeCoderCount} />}

        {/* Individuals/Teams toggle */}
        <LeaderboardToggle active="individuals" />

        {/* Time period filter */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-base font-bold text-foreground sm:text-lg">
            <span className="font-mono text-accent mr-2">$</span>
            {t("heading")}
          </h1>
          <TimeFilter current={period} from={range?.from} to={range?.to} />
        </div>

        {/* SEO intro — visible only to unauthenticated visitors (and crawlers) */}
        {!session?.user && (
          <p className="mb-6 font-mono text-xs leading-relaxed text-muted">
            <span className="text-dim select-none">{"// "}</span>
            {t("seoIntro")}{" "}
            <Link href="/stats" className="text-accent hover:underline">
              View community-wide usage statistics &rarr;
            </Link>
          </p>
        )}

        {/* Sync countdown for authenticated+synced users */}
        {lastSyncAt && (
          <SyncCountdown
            lastSyncAt={lastSyncAt.toISOString()}
            syncIntervalMs={syncIntervalMs ?? undefined}
          />
        )}

        {/* Pinned "Your Position" row */}
        <YourPosition
          myRow={myRow}
          unsyncedUser={
            session?.user && !hasSynced
              ? {
                  githubUsername: displayName,
                  image: session.user.image ?? null,
                }
              : undefined
          }
          period={period}
          rangeFrom={range?.from}
          rangeTo={range?.to}
        />

        {/* Leaderboard table */}
        <LeaderboardTable
          key={`${period}-${sort}-${order}-${range?.from ?? ""}-${range?.to ?? ""}`}
          rows={rows}
          sort={sort}
          order={order}
          currentUserId={session?.user?.id}
          totalCount={totalCount}
          period={period}
          rangeFrom={range?.from}
          rangeTo={range?.to}
        />
      </main>

      {/* Badge prompt — floating chat bubble for synced users */}
      {session?.user && hasSynced && !badgePromptDismissed && (
        <BadgePrompt
          username={displayName}
          baseUrl={env.NEXT_PUBLIC_BASE_URL}
        />
      )}
    </div>
  );
}
