import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { Header } from "@/components/layout/Header";
import {
  getCommunityStatsCached,
  getDailyTrendsCached,
  getModelStatsCached,
  getWeeklyGrowthCached,
} from "@/lib/db/cached";
import { CommunityTrendChart } from "@/components/stats/CommunityTrendChart";
import { ModelShareChart } from "@/components/stats/ModelShareChart";
import { GrowthChart } from "@/components/stats/GrowthChart";
import { SourceBreakdownChart } from "@/components/stats/SourceBreakdownChart";
import { StatCard } from "@/components/stats/StatCard";
import { ChartCard } from "@/components/stats/ChartCard";
import { StatsFaq } from "@/components/stats/StatsFaq";
import { StatsCta } from "@/components/stats/StatsCta";
import { StatsNav } from "@/components/stats/StatsNav";
import { friendlyModelName } from "@/lib/chart-utils";
import { getTranslations } from "next-intl/server";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

export const revalidate = 3600; // ISR: revalidate every hour

export async function generateMetadata(): Promise<Metadata> {
  const stats = await getCommunityStatsCached();
  const userCount = stats.totalUsers;
  const cost = formatNumber(parseFloat(stats.totalCost));

  return {
    title: `AI Coding Usage Statistics — Live Data from ${userCount}+ Developers`,
    description: `How much does AI coding cost? Real data from ${userCount}+ developers using Claude Code, OpenCode & Codex CLI: $${cost}+ total spend, model breakdowns, daily usage trends, and community growth. Updated hourly from opt-in usage logs.`,
    alternates: { canonical: `${BASE_URL}/stats` },
    openGraph: {
      title: `AI Coding Usage Statistics — ${userCount}+ Developers`,
      description: `Live usage data: $${cost}+ total spend, ${formatNumber(stats.totalTokens)}+ tokens across ${userCount} developers.`,
      type: "website",
    },
    keywords: [
      "ai coding usage",
      "ai coding cost",
      "ai coding tool usage statistics",
      "ai coding statistics",
      "vibecoding statistics",
      "vibecoding usage",
      "claude code cost",
      "claude opus usage",
      "claude sonnet usage",
      "ai agent usage statistics",
      "opencode usage",
      "codex cli usage",
      "vibecoding leaderboard",
    ],
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default async function StatsPage() {
  const t = await getTranslations("statsPage");
  const { getSourceBreakdown } = await import("@/lib/db/stats");
  const [stats, trends, models, growth, sourceBreakdown] = await Promise.all([
    getCommunityStatsCached(),
    getDailyTrendsCached(),
    getModelStatsCached(),
    getWeeklyGrowthCached(),
    getSourceBreakdown(),
  ]);

  const totalCost = parseFloat(stats.totalCost);
  const avgCost = parseFloat(stats.avgCostPerUser);
  const medianCost = parseFloat(stats.medianCostPerUser);
  const biggestDay = parseFloat(stats.biggestSingleDayCost);

  const faqs = [
    {
      q: t("faqQ1"),
      a: t("faqA1", {
        totalUsers: stats.totalUsers.toLocaleString(),
        avgCost: formatCurrency(avgCost),
        medianCost: formatCurrency(medianCost),
      }),
    },
    {
      q: t("faqQ2"),
      a: t("faqA2"),
    },
    {
      q: t("faqQ3"),
      a: t("faqA3"),
    },
    {
      q: t("faqQ4"),
      a: t("faqA4"),
    },
    {
      q: t("faqQ5"),
      a: t("faqA5"),
    },
    {
      q: t("faqQ6"),
      a: t("faqA6", {
        longestStreak: stats.longestStreak,
      }),
    },
    {
      q: t("faqQ7"),
      a: t("faqA7", {
        statsUrl: `${BASE_URL}/api/stats`,
        leaderboardUrl: `${BASE_URL}/api/leaderboard`,
      }),
    },
    {
      q: t("faqQ8"),
      a: t("faqA8"),
    },
  ];

  const topModel = models[0];
  const topModelName = topModel
    ? friendlyModelName(topModel.modelName)
    : "N/A";

  // ─── JSON-LD schemas ────────────────────────────────────────────────────────

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Usage Statistics" },
    ],
  };

  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "AI Coding Tool Community Usage Statistics",
    description: `Aggregated AI coding tool usage data from ${stats.totalUsers}+ developers — covering Claude Code, OpenCode, and Codex CLI — including cost estimates, token consumption, model popularity, and daily activity trends. Updated hourly.`,
    url: `${BASE_URL}/stats`,
    dateModified: new Date().toISOString(),
    temporalCoverage: "2024-01-01/..",
    creator: {
      "@type": "Organization",
      name: "clawdboard",
      url: BASE_URL,
    },
    distribution: {
      "@type": "DataDownload",
      contentUrl: `${BASE_URL}/api/stats`,
      encodingFormat: "application/json",
    },
    variableMeasured: [
      "Total estimated cost (USD)",
      "Token consumption (input, output, cache)",
      "Active developer count",
      "Model usage distribution",
      "Daily activity streaks",
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  const now = new Date();
  const lastUpdated = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div className="relative min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <Header
        subtitle={t("subtitle")}
        rightContent={
          <Link
            href="/"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            {t("backToLeaderboard")}
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* ── Breadcrumb ───────────────────────────────────────────────── */}
        <nav
          className="mb-6 font-mono text-xs text-muted"
          aria-label="Breadcrumb"
        >
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-accent transition-colors">
                {t("breadcrumbHome")}
              </Link>
            </li>
            <li className="text-dim">/</li>
            <li className="text-foreground">{t("breadcrumbStats")}</li>
          </ol>
        </nav>

        {/* ── Sub-nav ─────────────────────────────────────────────────── */}
        <StatsNav />

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="mb-10">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            <span className="text-accent mr-2">&gt;</span>
            {t("heroTitle")}
          </h1>
          <p className="mt-2 font-mono text-sm leading-relaxed text-muted max-w-3xl">
            {t.rich("heroDescription", {
              totalUsers: stats.totalUsers.toLocaleString(),
              strong: (chunks) => (
                <strong className="text-foreground">{chunks}</strong>
              ),
              link: (chunks) => (
                <Link href="/" className="text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
          {/* Data summary for LLM crawlers — visually hidden */}
          <span className="sr-only">
            As of {lastUpdated.split(",").slice(0, 2).join(",")},{" "}
            {stats.totalUsers.toLocaleString()} developers have tracked{" "}
            {formatCurrency(totalCost)} in estimated AI coding spend and{" "}
            {formatNumber(stats.totalTokens)} tokens on clawdboard.
            The average developer has spent an estimated{" "}
            {formatCurrency(avgCost)} (median: {formatCurrency(medianCost)}).
            {topModel && (
              <> The most-used model by cost share is{" "}
              {topModelName} at {topModel.costShare}% of total spend.{" "}
              </>
            )}
            {sourceBreakdown.length > 1 && (
              <>Usage is tracked across{" "}
              {sourceBreakdown
                .sort((a, b) => b.totalCost - a.totalCost)
                .map((s) => {
                  const labels: Record<string, string> = {
                    "claude-code": "Claude Code",
                    opencode: "OpenCode",
                    codex: "Codex CLI",
                  };
                  return labels[s.source] ?? s.source;
                })
                .join(", ")
                .replace(/, ([^,]*)$/, ", and $1")}
              .{" "}
              </>
            )}
            The longest active streak is {stats.longestStreak} consecutive days.
            Data is updated hourly from opt-in developer usage logs.
          </span>
          <p className="mt-2 font-mono text-[11px] text-dim">
            {t("lastUpdated", { lastUpdated })} &middot; {t("refreshedHourly")} &middot;{" "}
            <a
              href={`${BASE_URL}/api/stats`}
              className="text-accent/70 hover:text-accent hover:underline"
              target="_blank"
              rel="noopener"
            >
              {t("apiAccessAvailable")}
            </a>
          </p>
        </div>

        {/* ── Community overview cards ─────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="text-xl font-semibold text-foreground mb-1">
            <span className="text-accent mr-1.5">&gt;</span>
            {t("overviewHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("overviewDescription", { totalUsers: stats.totalUsers.toLocaleString() })}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
            <StatCard
              label={t("totalCommunitySpend")}
              value={formatCurrency(totalCost)}
              sub={t("acrossDevelopers", { totalUsers: stats.totalUsers.toLocaleString() })}
              accent
            />
            <StatCard
              label={t("totalTokensConsumed")}
              value={formatTokens(stats.totalTokens)}
              sub={t("tokensSub")}
            />
            <StatCard
              label={t("avgCostPerDeveloper")}
              value={formatCurrency(avgCost)}
              sub={t("medianSub", { medianCost: formatCurrency(medianCost) })}
            />
            <StatCard
              label={t("busiestCommunityDay")}
              value={formatCurrency(biggestDay)}
              sub={
                stats.biggestSingleDayDate
                  ? formatDate(stats.biggestSingleDayDate)
                  : "—"
              }
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label={t("totalActiveDays")}
              value={stats.totalActiveDays.toLocaleString()}
              sub={t("activeDaysSub")}
            />
            <StatCard
              label={t("longestActiveStreak")}
              value={`${stats.longestStreak}d`}
              sub={t("streakSub")}
            />
            <StatCard
              label={t("mostUsedModel")}
              value={topModelName}
              sub={
                topModel
                  ? t("modelShareSub", { costShare: topModel.costShare })
                  : "—"
              }
            />
          </div>
        </section>

        {/* ── Daily usage trends ──────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="trends-heading">
          <h2 id="trends-heading" className="text-xl font-semibold text-foreground mb-1">
            <span className="text-accent mr-1.5">&gt;</span>
            {t("trendsHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("trendsDescription", { trendDays: trends.length })}
          </p>
          <ChartCard>
            <CommunityTrendChart data={trends} />
          </ChartCard>
        </section>

        {/* ── Model breakdown ─────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="models-heading">
          <h2 id="models-heading" className="text-xl font-semibold text-foreground mb-1">
            <span className="text-accent mr-1.5">&gt;</span>
            {t("modelsHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("modelsDescription")}
          </p>
          <ChartCard>
            <ModelShareChart data={models} linkToModelPages />
          </ChartCard>
        </section>

        {/* ── Source breakdown ─────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="source-heading">
          <h2 id="source-heading" className="text-xl font-semibold text-foreground mb-1">
            <span className="text-accent mr-1.5">&gt;</span>
            {t("sourceHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("sourceDescription")}
          </p>
          <ChartCard>
            <SourceBreakdownChart data={sourceBreakdown} />
          </ChartCard>
          <p className="mt-3 font-mono text-xs text-muted">
            <Link href="/stats/tools" className="text-accent hover:underline">
              {t("viewDetailedToolComparison")}
            </Link>
          </p>
        </section>

        {/* ── Community growth ────────────────────────────────────────── */}
        <section className="mb-12" aria-labelledby="growth-heading">
          <h2 id="growth-heading" className="text-xl font-semibold text-foreground mb-1">
            <span className="text-accent mr-1.5">&gt;</span>
            {t("growthHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("growthDescription")}
          </p>
          <ChartCard>
            <GrowthChart data={growth} />
          </ChartCard>
        </section>

        {/* ── Divider: data zone → analysis zone ─────────────────────── */}
        <div className="border-t border-border my-14" />

        {/* ── Analysis: How much does AI coding cost? ────────────────── */}
        <section
          className="mb-10 rounded-lg border border-accent/20 bg-accent/[0.03] p-6 sm:p-8"
          aria-labelledby="cost-heading"
        >
          <h2
            id="cost-heading"
            className="text-xl font-semibold text-foreground mb-4"
          >
            {t("costAnalysisHeading")}
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              {t.rich("costAnalysisP1", {
                totalUsers: stats.totalUsers.toLocaleString(),
                avgCost: formatCurrency(avgCost),
                medianCost: formatCurrency(medianCost),
                strong: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
            </p>
            <p>
              {t("costAnalysisP2")}
            </p>
            <p>
              {t.rich("costAnalysisP3", {
                totalActiveDays: stats.totalActiveDays.toLocaleString(),
                longestStreak: stats.longestStreak,
                biggestDay: formatCurrency(biggestDay),
                strong: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
              {stats.biggestSingleDayDate && t("costAnalysisP3Date", { date: formatDate(stats.biggestSingleDayDate) })}
              .
            </p>
            <p>
              {t.rich("costAnalysisP4", {
                leaderboard: (chunks) => (
                  <Link href="/" className="text-accent hover:underline">
                    {chunks}
                  </Link>
                ),
                faq: (chunks) => (
                  <Link href="/faq" className="text-accent hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </section>

        {/* ── Data methodology ────────────────────────────────────────── */}
        <section
          className="mb-10"
          aria-labelledby="methodology-heading"
        >
          <h2
            id="methodology-heading"
            className="text-lg font-semibold text-foreground mb-4"
          >
            {t("methodologyHeading")}
          </h2>
          <div className="font-mono text-sm leading-relaxed text-muted mb-4">
            <p>
              {t.rich("methodologyP1", {
                link: (chunks) => (
                  <Link href="/" className="text-accent hover:underline">
                    {chunks}
                  </Link>
                ),
                cli: (chunks) => (
                  <a
                    href="https://www.npmjs.com/package/clawdboard"
                    className="text-accent hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-2">
                {t("methodologyCostEstimation")}
              </p>
              <p className="font-mono text-xs leading-relaxed text-muted">
                {t("methodologyCostEstimationText")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-2">
                {t("methodologyPrivacy")}
              </p>
              <p className="font-mono text-xs leading-relaxed text-muted">
                {t.rich("methodologyPrivacyText", {
                  link: (chunks) => (
                    <Link href="/privacy" className="text-accent hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-2">
                {t("methodologyLimitations")}
              </p>
              <p className="font-mono text-xs leading-relaxed text-muted">
                {t("methodologyLimitationsText", { totalUsers: stats.totalUsers.toLocaleString() })}
              </p>
            </div>
          </div>
        </section>

        {/* ── Public API ──────────────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-background p-6"
          aria-labelledby="api-heading"
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center rounded-full bg-success/10 border border-success/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-success">
              Public
            </span>
            <h2
              id="api-heading"
              className="text-lg font-semibold text-foreground"
            >
              {t("apiHeading")}
            </h2>
          </div>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              {t("apiDescription")}
            </p>
            <div className="rounded-md border border-border bg-background p-4 overflow-x-auto">
              <code className="text-xs text-foreground whitespace-pre">{`# All-time aggregate stats
GET ${BASE_URL}/api/stats

# Filter by period: today, 7d, 30d, this-month, ytd
GET ${BASE_URL}/api/stats?period=30d

# Custom date range
GET ${BASE_URL}/api/stats?period=custom&from=2025-01-01&to=2025-03-01

# Leaderboard data
GET ${BASE_URL}/api/leaderboard?period=7d&sort=cost&limit=10`}</code>
            </div>
            <p>
              {t.rich("apiExplanation", {
                today: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                sevenD: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                thirtyD: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                thisMonth: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                ytd: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                custom: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                from: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
                to: (chunks) => (
                  <code className="text-foreground/80">{chunks}</code>
                ),
              })}
            </p>
          </div>
        </section>

        {/* ── FAQ section with FAQPage schema ─────────────────────────── */}
        <StatsFaq
          heading={t("faqHeading")}
          description={t("faqDescription")}
          faqs={faqs}
        />

        {/* ── CTA ─────────────────────────────────────────────────────── */}
        <StatsCta
          heading={t("ctaHeading")}
          description={t("ctaDescription", { totalUsers: stats.totalUsers.toLocaleString() })}
          primaryLabel={t("ctaPrimaryLabel")}
          primaryHref="/"
          secondaryLabel={t("ctaSecondaryLabel")}
          secondaryHref="/faq"
        />
      </main>
    </div>
  );
}
