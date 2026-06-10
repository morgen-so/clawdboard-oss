export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { cookies } from "next/headers";
import { cachedAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { Header } from "@/components/layout/Header";
import { FooterNav } from "@/components/layout/FooterNav";
import {
  getTeamBySlug,
  getTeamMembers,
  getTeamMembership,
  getUserTeams,
} from "@/lib/db/teams";
import {
  getTeamStats,
  getTeamLeaderboardData,
  VALID_PERIODS,
  VALID_SORTS,
  VALID_ORDERS,
  parseDateRange,
  type Period,
  type SortCol,
  type SortOrder,
} from "@/lib/db/cached";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { TimeFilter } from "@/components/leaderboard/TimeFilter";
import { TeamSwitcher } from "@/components/teams/TeamSwitcher";
import { TeamInviteSection } from "@/components/teams/TeamInviteSection";
import { TeamCreatedModal } from "@/components/teams/TeamCreatedModal";
import { UserNav } from "@/components/auth/UserNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { safeHostname, buildInviteUrl } from "@/lib/url";
import { PERIOD_COOKIE, parsePeriodCookie } from "@/lib/period-cookie";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { seoAlternates } from "@/lib/seo";
import { formatTokensCompact, formatUsd, formatUsdShort } from "@/lib/format";
import { getTranslations } from "next-intl/server";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    created?: string;
    period?: string;
    sort?: string;
    order?: string;
    from?: string;
    to?: string;
  }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: "Team Not Found" };

  const stats = await getTeamStats(team.id);
  const title = `${team.name} — Team AI Coding Usage & Stats`;
  const description = `See ${team.name}'s AI coding usage — ${stats.memberCount} members, ${formatUsdShort(stats.totalCost)} total spend, ${stats.activeDays} active days. View the full breakdown on clawdboard.`;

  return {
    title,
    description,
    alternates: seoAlternates(`/team/${slug}`),
    openGraph: {
      title: `${title} | clawdboard`,
      description,
      url: `${BASE_URL}/team/${slug}`,
    },
  };
}


export default async function TeamProfilePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  // Parallelize independent lookups
  const [team, session] = await Promise.all([
    getTeamBySlug(slug),
    cachedAuth(),
  ]);
  if (!team) {
    notFound();
  }

  // Fetch viewer context + user's teams
  let membership: { role: string } | null = null;
  let userTeams: Awaited<ReturnType<typeof getUserTeams>> = [];

  if (session?.user?.id) {
    [membership, userTeams] = await Promise.all([
      getTeamMembership(team.id, session.user.id),
      getUserTeams(session.user.id),
    ]);
  }

  const isMember = !!membership;
  const isOwner = membership?.role === "owner";

  // Parse time filter/sort from URL params with cookie fallback
  // Members default to cookie preference or "this-month"; non-members default to "ytd"
  const saved = isMember
    ? parsePeriodCookie((await cookies()).get(PERIOD_COOKIE)?.value)
    : null;

  const period: Period = VALID_PERIODS.includes(sp.period as Period)
    ? (sp.period as Period)
    : saved?.period ?? (isMember ? "this-month" : "ytd");
  const sort: SortCol = VALID_SORTS.includes(sp.sort as SortCol)
    ? (sp.sort as SortCol)
    : "cost";
  const order: SortOrder = VALID_ORDERS.includes(sp.order as SortOrder)
    ? (sp.order as SortOrder)
    : "desc";

  const range = period === "custom"
    ? parseDateRange(sp.from ?? saved?.from, sp.to ?? saved?.to)
    : undefined;

  const t = await getTranslations("team");

  // Parallel data fetch (no separate getActiveMemberCount — derived from members)
  const [stats, members, memberStats] = await Promise.all([
    getTeamStats(team.id, period, range),
    getTeamMembers(team.id),
    getTeamLeaderboardData(team.id, period, sort, order, range),
  ]);

  const activeMembers = members.filter((m) => !m.leftAt && m.status === "active");
  const pendingMembers = members.filter((m) => !m.leftAt && m.status === "pending");
  const formerMembers = members.filter((m) => m.leftAt !== null);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Teams", item: `${BASE_URL}/teams` },
      { "@type": "ListItem", position: 3, name: team.name },
    ],
  };

  return (
    <div className="relative min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* Post-creation invite modal (owner only, on first redirect) */}
      {sp.created === "true" && isOwner && (
        <TeamCreatedModal
          teamName={team.name}
          inviteUrl={buildInviteUrl(BASE_URL, team.slug, team.inviteToken)}
        />
      )}

      {/* Header */}
      <Header
        subtitle={team.name}
        rightContent={
          session?.user ? (
            <>
              <NotificationBell />
              <UserNav
                name={session.user.githubUsername ?? session.user.name}
                image={session.user.image}
              />
            </>
          ) : undefined
        }
      />

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        {/* Back link — visible to non-members only */}
        {!isMember && (
          <Link
            href="/teams"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
          >
            <span aria-hidden="true">&larr;</span> {t("backToTeamLeaderboard")}
          </Link>
        )}

        {/* Team heading row: switcher (if member) + team name + time filter */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-display text-lg font-bold text-foreground">
              <span className="text-accent mr-2">&gt;</span>
              {isMember && userTeams.length > 1 ? (
                <TeamSwitcher
                  teams={userTeams}
                  currentSlug={team.slug}
                />
              ) : (
                team.name
              )}
            </h1>
            {isMember && (
              <Link
                href={`/team/${team.slug}/settings`}
                className="font-mono text-xs text-muted transition-colors hover:text-foreground"
                title="Team settings"
              >
                &#9881; {t("settings")}
              </Link>
            )}
          </div>
          <TimeFilter current={period} from={range?.from} to={range?.to} />
        </div>

        {/* Team profile card with stat cards */}
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                {/* When heading shows the switcher dropdown, reinstate team name in the card */}
                {isMember && userTeams.length > 1 && (
                  <h2 className="font-display text-xl font-bold text-foreground">
                    {team.name}
                  </h2>
                )}
                {team.isPublic && (
                  <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-mono text-[10px] font-medium text-accent">
                    {t("publicTeam")}
                  </span>
                )}
              </div>
              {team.cookingUrl && (
                <p className="mt-1 text-sm">
                  <span>&#129489;&#8205;&#127859;</span>{" "}
                  <a
                    href={team.cookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent transition-colors hover:text-accent/80"
                  >
                    {team.cookingLabel ||
                      safeHostname(team.cookingUrl)}
                  </a>
                </p>
              )}
              {membership && (
                <p className="mt-1 font-mono text-xs text-muted">
                  {t("youAreRole", { role: membership.role })}
                </p>
              )}
            </div>
          </div>

          {/* Stat cards grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-background p-4">
              <p className="text-xs font-medium text-muted mb-1">{t("totalCost")}</p>
              <p className="font-mono text-lg font-semibold text-accent">
                {formatUsd(stats.totalCost)}
              </p>
            </div>

            <div className="rounded-lg bg-background p-4">
              <p className="text-xs font-medium text-muted mb-1">
                {t("totalTokens")}
              </p>
              <p className="font-mono text-lg font-semibold text-foreground">
                {formatTokensCompact(stats.totalTokens)}
              </p>
            </div>

            <div className="rounded-lg bg-background p-4">
              <p className="text-xs font-medium text-muted mb-1 inline-flex items-center gap-1">
                {t("activeDays")}
                <InfoTooltip text={t("activeDaysTooltip")} />
              </p>
              <p className="font-mono text-lg font-semibold text-foreground">
                {stats.activeDays}
              </p>
            </div>

            <div className="rounded-lg bg-background p-4">
              <p className="text-xs font-medium text-muted mb-1">
                {t("activeMembers")}
              </p>
              <p className="font-mono text-lg font-semibold text-foreground">
                {stats.memberCount}
              </p>
            </div>
          </div>
        </div>

        {/* Invite section — visible to members only */}
        {isMember && (
          <TeamInviteSection
            teamSlug={team.slug}
            teamId={team.id}
            inviteToken={team.inviteToken}
            isLocked={team.isLocked ?? false}
            memberCount={activeMembers.length}
          />
        )}

        {/* Pending invitations — visible to members only */}
        {isMember && pendingMembers.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {pendingMembers.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2"
              >
                {member.image ? (
                  <Image
                    src={member.image}
                    alt=""
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded-full ring-1 ring-border opacity-60"
                  />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-border/60 text-[9px] font-medium text-dim">
                    ?
                  </div>
                )}
                <span className="font-mono text-xs text-muted">
                  {member.githubUsername ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-accent">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {t("pending")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Leaderboard table */}
        <LeaderboardTable
          key={`${period}-${sort}-${order}-${range?.from ?? ""}-${range?.to ?? ""}`}
          rows={memberStats}
          sort={sort}
          order={order}
          currentUserId={session?.user?.id}
          period={period}
          rangeFrom={range?.from}
          rangeTo={range?.to}
        />

        {/* Former contributors */}
        {formerMembers.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-sm font-bold text-muted">
              {t("formerContributors", { count: formerMembers.length })}
            </h2>
            <div className="flex flex-wrap gap-3">
              {formerMembers.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface/50 px-3 py-2"
                >
                  {member.image ? (
                    <Image
                      src={member.image}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6 rounded-full ring-1 ring-border opacity-60"
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-border/60 text-[9px] font-medium text-dim">
                      FC
                    </div>
                  )}
                  <span className="font-mono text-xs text-muted">
                    {t("formerContributor")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer nav */}
        <FooterNav className="mt-2" />
      </main>
    </div>
  );
}
