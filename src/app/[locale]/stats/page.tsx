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
import { CopyIconButton } from "@/components/leaderboard/CopyIconButton";
import { friendlyModelName } from "@/lib/chart-utils";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

export const revalidate = 3600; // ISR: revalidate every hour

export async function generateMetadata(): Promise<Metadata> {
  const stats = await getCommunityStatsCached();
  const userCount = stats.totalUsers;
  const cost = formatNumber(parseFloat(stats.totalCost));

  return {
    title: `Claude Code Usage Statistics — Live Data from ${userCount}+ Developers`,
    description: `How much does Claude Code cost? Real data from ${userCount}+ developers: $${cost}+ total spend, model breakdowns (Opus vs Sonnet vs Haiku), daily usage trends, and community growth. Updated hourly from opt-in usage logs.`,
    alternates: { canonical: `${BASE_URL}/stats` },
    openGraph: {
      title: `Claude Code Usage Statistics — ${userCount}+ Developers`,
      description: `Live usage data: $${cost}+ total spend, ${formatNumber(stats.totalTokens)}+ tokens across ${userCount} developers.`,
      type: "website",
    },
    keywords: [
      "claude code usage",
      "claude code cost",
      "claude code statistics",
      "vibecoding usage",
      "ai coding cost",
      "claude opus usage",
      "claude sonnet usage",
      "ai agent usage statistics",
      "claude code spending",
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

// ─── FAQ data (used for both rendering and JSON-LD) ─────────────────────────

function getStatsFaqs(stats: {
  totalUsers: number;
  avgCost: string;
  medianCost: string;
  longestStreak: number;
}) {
  return [
    {
      q: "How much does Claude Code cost per month?",
      a: `Based on data from ${stats.totalUsers.toLocaleString()} developers on clawdboard, the average estimated usage cost is ${stats.avgCost} total (not per month). The median is ${stats.medianCost}, meaning half of developers spend less than that. These are estimated API-equivalent costs — most developers pay a flat monthly fee through Anthropic's Pro ($20/mo) or Max ($100-200/mo) subscriptions, not per-token billing.`,
    },
    {
      q: "What is the most popular Claude model for coding?",
      a: "Model popularity varies over time as Anthropic releases new versions. Check the Model Popularity chart above for the latest breakdown by cost share and user count. Historically, Sonnet models see the highest volume due to their speed-to-quality ratio, while Opus models account for a significant share of total spend due to higher per-token pricing.",
    },
    {
      q: "Where does this usage data come from?",
      a: "Every data point comes from developers who voluntarily track their Claude Code usage through clawdboard. The clawdboard CLI reads local JSONL log files that Claude Code stores in ~/.claude/ on each developer's machine, extracts aggregate token counts and cost estimates, and syncs them. No code, prompts, project names, or conversation content is ever collected — only token counts and estimated costs.",
    },
    {
      q: "How accurate are the cost estimates?",
      a: "Cost estimates are calculated by multiplying token counts (input, output, cache creation, cache read) by Anthropic's published API rates for each model. They represent the equivalent API cost — not an actual bill. Since most developers use Claude Code through Pro or Max subscriptions with flat monthly pricing, the actual amount paid is typically lower than the estimated API-equivalent cost shown here.",
    },
    {
      q: "How often is this data updated?",
      a: "Individual developers sync their usage every 2 hours by default. The aggregate statistics on this page are recalculated hourly. The data covers all usage since January 2024, when Claude Code was first released.",
    },
    {
      q: "What is a streak and how is it calculated?",
      a: `A streak counts consecutive calendar days where a developer used Claude Code at least once. Missing a single day resets the streak. The longest active streak in the community is currently ${stats.longestStreak} days. You can see individual streaks on the leaderboard and profile pages.`,
    },
    {
      q: "Can I access this data programmatically?",
      a: `Yes. clawdboard provides a free public API at ${BASE_URL}/api/stats that returns community-wide aggregate statistics including total spend, token counts, model breakdowns, and methodology notes. The API is rate-limited to 15 requests per minute and returns JSON. The leaderboard API at ${BASE_URL}/api/leaderboard is also public.`,
    },
    {
      q: "Is this data representative of all Claude Code users?",
      a: "No. This is a self-selected sample of developers who choose to track and share their usage on clawdboard. It likely skews toward heavier users and early adopters. It should not be interpreted as representative of all Claude Code users, but it does provide the largest public dataset of real Claude Code usage patterns available.",
    },
  ];
}

export default async function StatsPage() {
  const [stats, trends, models, growth] = await Promise.all([
    getCommunityStatsCached(),
    getDailyTrendsCached(),
    getModelStatsCached(),
    getWeeklyGrowthCached(),
  ]);

  const totalCost = parseFloat(stats.totalCost);
  const avgCost = parseFloat(stats.avgCostPerUser);
  const medianCost = parseFloat(stats.medianCostPerUser);
  const biggestDay = parseFloat(stats.biggestSingleDayCost);

  const faqs = getStatsFaqs({
    totalUsers: stats.totalUsers,
    avgCost: formatCurrency(avgCost),
    medianCost: formatCurrency(medianCost),
    longestStreak: stats.longestStreak,
  });

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
    name: "Claude Code Community Usage Statistics",
    description: `Aggregated Claude Code usage data from ${stats.totalUsers}+ developers including cost estimates, token consumption, model popularity, and daily activity trends. Updated hourly.`,
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
        subtitle="usage statistics"
        rightContent={
          <Link
            href="/"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            &larr; leaderboard
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* ── H1: page title + intro ──────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            <span className="text-accent mr-2">&gt;</span>
            Claude Code Usage Statistics
          </h1>
          <p className="mt-2 font-mono text-sm leading-relaxed text-muted max-w-3xl">
            Real-time aggregate data from{" "}
            <strong className="text-foreground">
              {stats.totalUsers.toLocaleString()} developers
            </strong>{" "}
            who track their Claude Code usage on{" "}
            <Link href="/" className="text-accent hover:underline">
              clawdboard
            </Link>
            . All cost figures are estimates based on Anthropic&apos;s published
            API token pricing — not actual bills. Data covers all usage since
            January 2024.
          </p>
          <p className="mt-1 font-mono text-[11px] text-dim">
            Last updated: {lastUpdated} &middot; Refreshed hourly &middot;{" "}
            <a
              href={`${BASE_URL}/api/stats`}
              className="text-accent/70 hover:text-accent hover:underline"
              target="_blank"
              rel="noopener"
            >
              API access available
            </a>
          </p>
        </div>

        {/* ── Community overview cards ─────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="text-lg font-semibold text-foreground mb-1">
            Community Overview
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            Aggregate Claude Code usage across all {stats.totalUsers.toLocaleString()} registered
            developers since January 2024.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
            <StatCard
              label="Total Community Spend"
              value={formatCurrency(totalCost)}
              sub={`across ${stats.totalUsers.toLocaleString()} developers`}
            />
            <StatCard
              label="Total Tokens Consumed"
              value={formatTokens(stats.totalTokens)}
              sub="input + output + cache"
            />
            <StatCard
              label="Average Cost per Developer"
              value={formatCurrency(avgCost)}
              sub={`median: ${formatCurrency(medianCost)}`}
            />
            <StatCard
              label="Busiest Community Day"
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
              label="Total Active Days"
              value={stats.totalActiveDays.toLocaleString()}
              sub="developer-days logged"
            />
            <StatCard
              label="Longest Active Streak"
              value={`${stats.longestStreak}d`}
              sub="consecutive days coding with Claude"
            />
            <StatCard
              label="Most Used Model"
              value={topModelName}
              sub={
                topModel
                  ? `${topModel.costShare}% of total spend`
                  : "—"
              }
            />
          </div>
        </section>

        {/* ── Daily usage trends ──────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="trends-heading">
          <h2 id="trends-heading" className="text-lg font-semibold text-foreground mb-1">
            Daily Claude Code Usage Trends
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            How much are developers spending on Claude Code each day? This chart
            shows the 7-day moving average of estimated daily cost and active
            user count over the last {trends.length} days. Spikes often
            correspond to new Claude model releases or major feature updates.
          </p>
          <CommunityTrendChart data={trends} />
        </section>

        {/* ── Model breakdown ─────────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="models-heading">
          <h2 id="models-heading" className="text-lg font-semibold text-foreground mb-1">
            Claude Model Popularity: Opus vs Sonnet vs Haiku
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            Which Claude models do developers actually use for coding? This
            breakdown shows estimated cost and token consumption per model
            across all users. Cost share reflects how much of total community
            spend goes to each model — higher-tier models like Opus cost more
            per token, so they can dominate spend even with fewer users.
          </p>
          <ModelShareChart data={models} />
        </section>

        {/* ── Community growth ────────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="growth-heading">
          <h2 id="growth-heading" className="text-lg font-semibold text-foreground mb-1">
            Community Growth
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            How fast is the Claude Code developer community growing? This chart
            tracks cumulative registrations on clawdboard by week. Growth
            accelerates around major Claude model releases and developer tool
            announcements.
          </p>
          <GrowthChart data={growth} />
        </section>

        {/* ── Analysis: How much does Claude Code cost? ───────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="cost-heading"
        >
          <h2
            id="cost-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            How Much Does Claude Code Actually Cost?
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              Based on data from{" "}
              {stats.totalUsers.toLocaleString()} developers, the average
              Claude Code user has an estimated all-time usage of{" "}
              <strong className="text-foreground">
                {formatCurrency(avgCost)}
              </strong>{" "}
              in API-equivalent cost. The median is{" "}
              <strong className="text-foreground">
                {formatCurrency(medianCost)}
              </strong>
              , reflecting the wide gap between casual users and power users who
              run Claude Code daily for extended sessions.
            </p>
            <p>
              These are not actual bills. They represent what the same token
              usage would cost at Anthropic&apos;s published API rates. Most
              Claude Code users pay a flat monthly subscription — $20/month for
              Pro or $100-200/month for Max — rather than per-token billing.
              The estimated cost is useful for comparing relative usage
              intensity across developers and understanding which models
              consume the most resources.
            </p>
            <p>
              The community has logged{" "}
              <strong className="text-foreground">
                {stats.totalActiveDays.toLocaleString()} active days
              </strong>{" "}
              of Claude Code usage, with the longest consecutive streak
              reaching{" "}
              <strong className="text-foreground">
                {stats.longestStreak} days
              </strong>
              . The busiest single day across the community saw{" "}
              <strong className="text-foreground">
                {formatCurrency(biggestDay)}
              </strong>{" "}
              in estimated usage
              {stats.biggestSingleDayDate && (
                <>
                  {" "}
                  on {formatDate(stats.biggestSingleDayDate)}
                </>
              )}
              .
            </p>
            <p>
              Want to see where you stand?{" "}
              <Link href="/" className="text-accent hover:underline">
                View the leaderboard
              </Link>{" "}
              to compare your usage, or{" "}
              <Link href="/faq" className="text-accent hover:underline">
                read the FAQ
              </Link>{" "}
              to learn how tracking works.
            </p>
          </div>
        </section>

        {/* ── Data methodology ────────────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="methodology-heading"
        >
          <h2
            id="methodology-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            Data Sources and Methodology
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              All data on this page comes from developers who voluntarily track
              their Claude Code usage through{" "}
              <Link href="/" className="text-accent hover:underline">
                clawdboard
              </Link>
              . The{" "}
              <a
                href="https://www.npmjs.com/package/clawdboard"
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                clawdboard CLI
              </a>{" "}
              reads the JSONL log files that Claude Code stores locally in{" "}
              <code className="text-foreground/80">~/.claude/</code> on each
              developer&apos;s machine. It extracts aggregate token counts
              (input, output, cache creation, cache read) and the model used
              for each session.
            </p>
            <p>
              <strong className="text-foreground">
                Cost estimation:
              </strong>{" "}
              Token counts are multiplied by Anthropic&apos;s published API
              rates for each model at the time of the session. This gives the
              API-equivalent cost — useful for comparison, but not what
              subscription users actually pay.
            </p>
            <p>
              <strong className="text-foreground">Privacy:</strong> No code,
              prompts, file paths, project names, or conversation content is
              ever collected. Only aggregate token counts and model identifiers
              leave the developer&apos;s machine. See our{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                privacy policy
              </Link>{" "}
              for details.
            </p>
            <p>
              <strong className="text-foreground">Limitations:</strong> This is
              a self-selected sample of {stats.totalUsers.toLocaleString()}{" "}
              developers, likely skewing toward heavier users and early
              adopters. It should not be interpreted as representative of all
              Claude Code users.
            </p>
          </div>
        </section>

        {/* ── Public API ──────────────────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="api-heading"
        >
          <h2
            id="api-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            Public Stats API
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              Need this data programmatically? clawdboard provides free,
              public API endpoints for aggregate usage statistics:
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
              Both APIs return JSON with no authentication required.
              Rate-limited to 15 requests per minute. The stats endpoint
              supports the same period filters as the leaderboard:{" "}
              <code className="text-foreground/80">today</code>,{" "}
              <code className="text-foreground/80">7d</code>,{" "}
              <code className="text-foreground/80">30d</code>,{" "}
              <code className="text-foreground/80">this-month</code>,{" "}
              <code className="text-foreground/80">ytd</code>, and{" "}
              <code className="text-foreground/80">custom</code> (with{" "}
              <code className="text-foreground/80">from</code> and{" "}
              <code className="text-foreground/80">to</code> dates). Omit the
              period parameter for all-time aggregates. If you use this data,
              please cite clawdboard as the source.
            </p>
          </div>
        </section>

        {/* ── FAQ section with FAQPage schema ─────────────────────────────── */}
        <section className="mb-10" aria-labelledby="faq-heading">
          <h2
            id="faq-heading"
            className="text-lg font-semibold text-foreground mb-1"
          >
            Frequently Asked Questions About Claude Code Usage
          </h2>
          <p className="font-mono text-xs text-muted mb-6">
            Common questions about Claude Code costs, model usage, and how this
            data is collected.
          </p>

          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group rounded-lg border border-border bg-surface overflow-hidden"
              >
                <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 font-display text-sm font-semibold text-foreground select-none hover:bg-surface-hover transition-colors [&::-webkit-details-marker]:hidden list-none">
                  <span className="text-accent font-mono text-xs shrink-0">
                    [{String(i + 1).padStart(2, "0")}]
                  </span>
                  <span className="flex-1">{faq.q}</span>
                  <svg
                    className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <div className="border-t border-border px-5 py-4">
                  <p className="font-mono text-xs leading-relaxed text-muted pl-8">
                    {faq.a}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <section
          className="rounded-lg border border-accent/30 bg-accent/5 p-6 text-center"
          aria-labelledby="cta-heading"
        >
          <h2
            id="cta-heading"
            className="font-display text-lg font-bold text-foreground mb-2"
          >
            Track Your Own Claude Code Usage
          </h2>
          <p className="font-mono text-sm text-muted mb-4">
            Join {stats.totalUsers.toLocaleString()} developers on the
            leaderboard. Free, open-source, takes 30 seconds to set up.
          </p>

          {/* Command + copy */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 font-mono text-sm">
              <span className="text-dim/60 select-none">$</span>
              <code className="text-foreground/80">npx clawdboard auth</code>
              <CopyIconButton text="npx clawdboard auth" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-mono text-sm font-semibold text-background transition-colors hover:bg-accent/90"
            >
              View Leaderboard
            </Link>
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 font-mono text-sm text-muted transition-colors hover:text-foreground hover:border-foreground/20"
            >
              How It Works
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
        {label}
      </p>
      <p className="font-display text-xl font-bold text-foreground sm:text-2xl">
        {value}
      </p>
      <p className="font-mono text-[11px] text-dim mt-0.5">{sub}</p>
    </div>
  );
}
