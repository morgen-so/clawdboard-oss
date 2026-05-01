export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { seoAlternates } from "@/lib/seo";
import { cachedAuth } from "@/lib/auth";
import { getUserTeams } from "@/lib/db/teams";
import { getPublicTeamLeaderboard, VALID_PERIODS, parseDateRange, type Period } from "@/lib/db/cached";
import { LeaderboardToggle } from "@/components/leaderboard/LeaderboardToggle";
import { TimeFilter } from "@/components/leaderboard/TimeFilter";
import { YourTeamPosition } from "@/components/leaderboard/YourTeamPosition";
import { safeHostname } from "@/lib/url";
import { SignInButton } from "@/components/auth/SignInButton";
import { UserNav } from "@/components/auth/UserNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Header } from "@/components/layout/Header";
import { rankColors, rankIcons, rankBorderClass } from "@/lib/rank";
import { cookies } from "next/headers";
import { PERIOD_COOKIE, parsePeriodCookie } from "@/lib/period-cookie";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Team Leaderboard — Compare AI Coding Usage by Team",
  description:
    "See which teams spend the most on AI coding. Ranked by total cost, tokens, and active members — compare your team's usage against others.",
  alternates: seoAlternates("/teams"),
};

interface PageProps {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}

export default async function TeamLeaderboardPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const saved = parsePeriodCookie((await cookies()).get(PERIOD_COOKIE)?.value);

  const period: Period = VALID_PERIODS.includes(params.period as Period)
    ? (params.period as Period)
    : saved?.period ?? "this-month";

  const range = period === "custom"
    ? parseDateRange(params.from ?? saved?.from, params.to ?? saved?.to)
    : undefined;

  const [rows, session, t] = await Promise.all([
    getPublicTeamLeaderboard(period, range),
    cachedAuth(),
    getTranslations("team"),
  ]);

  // Get user's teams + find their position in the public leaderboard
  let userTeams: Awaited<ReturnType<typeof getUserTeams>> = [];
  if (session?.user?.id) {
    userTeams = await getUserTeams(session.user.id).catch(() => []);
  }

  // Find user's highest-ranked public team, or fall back to first team
  const myTeamRow = userTeams.length > 0
    ? rows.find(r => userTeams.some(ut => ut.teamId === r.teamId))
    : undefined;
  const myTeam = userTeams.length > 0
    ? (myTeamRow
        ? userTeams.find(ut => ut.teamId === myTeamRow.teamId)!
        : userTeams[0])
    : undefined;

  return (
    <div className="relative min-h-screen bg-background">
      {/* Header */}
      <Header
        subtitle="ai coding leaderboard"
        rightContent={
          session?.user ? (
            <>
              <NotificationBell />
              <UserNav
                name={session.user.githubUsername ?? session.user.name}
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
        {/* Individuals/Teams toggle */}
        <LeaderboardToggle active="teams" />

        {/* Time period filter */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-base font-bold text-foreground sm:text-lg">
            <span className="font-mono text-accent mr-2">$</span>
            {t("teamRankings")}
          </h1>
          <TimeFilter current={period} from={range?.from} to={range?.to} />
        </div>

        {/* Pinned team position — mirrors YourPosition on individuals page */}
        {session?.user && (
          <YourTeamPosition team={myTeam} publicRow={myTeamRow} />
        )}

        {/* Team leaderboard table */}
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-widest text-muted">
                <th className="px-3 py-3 w-10 sm:px-4 sm:w-12">#</th>
                <th className="px-3 py-3 sm:px-4">{t("teamHeader")}</th>
                <th className="px-3 py-3 text-right sm:px-4">{t("members")}</th>
                <th className="px-3 py-3 text-right sm:px-4">{t("cost")}</th>
                <th className="hidden sm:table-cell px-4 py-3 text-right">{t("tokens")}</th>
                <th className="hidden md:table-cell px-4 py-3 text-left">&#129489;&#8205;&#127859; {t("cooking")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted">
                      <span className="text-2xl opacity-40">&gt;_</span>
                      <span className="text-sm">{t("noPublicTeams")}</span>
                      <span className="text-xs text-dim">
                        {t("teamsOptIn")}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const isTop3 = row.rank <= 3;
                  return (
                    <tr
                      key={row.teamId}
                      className={`group row-stagger transition-colors hover:bg-surface-hover ${row.rank === 1 ? "bg-amber-400/[0.04]" : ""}`}
                      style={
                        { "--row-index": index } as React.CSSProperties
                      }
                    >
                      {/* Rank */}
                      <td
                        className={`px-3 py-3 sm:px-4 font-semibold ${isTop3 ? rankColors[row.rank] : "text-dim"} ${rankBorderClass(row.rank)}`}
                      >
                        {isTop3 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-xs">{rankIcons[row.rank]}</span>
                            {row.rank}
                          </span>
                        ) : (
                          row.rank
                        )}
                      </td>

                      {/* Team name */}
                      <td className="px-3 py-3 sm:px-4">
                        <Link
                          href={`/team/${row.teamSlug}`}
                          className={`font-medium transition-colors hover:text-accent ${isTop3 ? "text-foreground" : "text-foreground/80"}`}
                        >
                          {row.teamName}
                        </Link>
                      </td>

                      {/* Members */}
                      <td className="px-3 py-3 sm:px-4 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
                        {row.activeMembers}
                      </td>

                      {/* Cost */}
                      <td className="px-3 py-3 sm:px-4 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
                        <span className="text-muted">$</span>
                        {Number(row.totalCost).toFixed(2)}
                      </td>

                      {/* Tokens */}
                      <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
                        {Number(row.totalTokens).toLocaleString()}
                      </td>

                      {/* Cooking */}
                      <td className="hidden md:table-cell px-4 py-3 text-left">
                        {row.cookingUrl ? (
                          <a
                            href={row.cookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-accent transition-colors hover:text-accent/80 truncate max-w-[140px] inline-block"
                          >
                            {row.cookingLabel ||
                              safeHostname(row.cookingUrl)}
                          </a>
                        ) : (
                          <span className="text-dim">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Sparse-state CTA — surface a "Room at the top" prompt whenever
            there are more slots than teams. Keeps the page from feeling
            like a desert when only a handful of teams are public. */}
        {rows.length > 0 && rows.length < 8 && !session?.user && (
          <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-6 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-base font-bold text-foreground">
                  <span className="text-accent mr-2">$</span>
                  {t("roomAtTheTop")}
                </p>
                <p className="mt-1 font-mono text-sm text-muted max-w-xl">
                  {t("beTheNextTeam")}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Link
                  href="/signin"
                  className="rounded-lg bg-accent px-4 py-2 text-center font-mono text-xs font-medium text-background transition-colors hover:bg-accent/90"
                >
                  {t("signUpWithGitHub")}
                </Link>
                <Link
                  href="/faq#teams"
                  className="font-mono text-xs text-muted hover:text-foreground transition-colors sm:ml-2"
                >
                  {t("howTeamsWork")}
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
