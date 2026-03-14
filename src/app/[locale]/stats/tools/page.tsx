import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { Header } from "@/components/layout/Header";
import {
  getSourceDetailStatsCached,
  getSourceComparisonTrendsCached,
  getSourceModelBreakdownCached,
} from "@/lib/db/cached";
import { getSourceBreakdown } from "@/lib/db/stats";
import { ToolComparisonChart } from "@/components/stats/ToolComparisonChart";
import { ModelShareChart } from "@/components/stats/ModelShareChart";
import { StatCard } from "@/components/stats/StatCard";
import { ChartCard } from "@/components/stats/ChartCard";
import { StatsFaq } from "@/components/stats/StatsFaq";
import { StatsCta } from "@/components/stats/StatsCta";
import { StatsNav } from "@/components/stats/StatsNav";
import { friendlyModelName } from "@/lib/chart-utils";
import { type ToolMeta, getToolMeta, getActiveTools, toolNameList } from "@/lib/tools";
import { getTranslations } from "next-intl/server";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

export const revalidate = 3600;

/** Format tool names as "A vs B vs C" */
function toolVsList(tools: ToolMeta[]): string {
  return tools.map((t) => t.name).join(" vs ");
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

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

// ─── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  const breakdown = await getSourceBreakdown();
  const activeTools = getActiveTools(breakdown);
  const totalUsers = breakdown.reduce((s, b) => s + b.userCount, 0);
  const totalCost = breakdown.reduce((s, b) => s + b.totalCost, 0);

  const vsNames = toolVsList(activeTools);
  const listNames = toolNameList(activeTools);

  const title = `AI Coding Tool Comparison — ${vsNames} | clawdboard`;
  const description = `Compare ${listNames} usage side by side. Real data from ${totalUsers}+ developers: ${formatCurrency(totalCost)}+ total spend, model breakdowns, daily trends, and adoption metrics. Updated hourly.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/stats/tools` },
    openGraph: {
      title: `AI Coding Tool Comparison — Real Usage Data from ${totalUsers}+ Developers`,
      description,
      type: "website",
      url: `${BASE_URL}/stats/tools`,
    },
    keywords: [
      ...activeTools.flatMap((t) => [
        `${t.name.toLowerCase()} usage statistics`,
        `${t.name.toLowerCase()} cost`,
      ]),
      ...activeTools
        .slice(0, -1)
        .map(
          (t, i) =>
            `${t.name.toLowerCase()} vs ${activeTools[i + 1].name.toLowerCase()}`
        ),
      "ai coding tool comparison",
      "ai coding tool cost",
      "vibecoding tools",
      "best ai coding tool",
      "ai coding assistant comparison",
    ],
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function ToolsPage() {
  const t = await getTranslations("statsTools");
  const breakdown = await getSourceBreakdown();
  const activeTools = getActiveTools(breakdown);

  const [comparisonTrends, ...toolDetails] = await Promise.all([
    getSourceComparisonTrendsCached(),
    ...activeTools.map((t) => getSourceDetailStatsCached(t.slug)),
  ]);

  // Fetch model breakdowns for each tool that has data
  const toolModels = await Promise.all(
    activeTools.map((t, i) =>
      toolDetails[i]
        ? getSourceModelBreakdownCached(t.slug)
        : Promise.resolve([])
    )
  );

  const totalCost = breakdown.reduce((s, b) => s + b.totalCost, 0);
  const totalTokens = breakdown.reduce((s, b) => s + b.totalTokens, 0);
  const totalUsers = breakdown.reduce((s, b) => s + b.userCount, 0);
  const toolCount = activeTools.length;
  const listNames = toolNameList(activeTools);

  // Rank tools by cost for dynamic prose
  const rankedTools = [...breakdown]
    .sort((a, b) => b.totalCost - a.totalCost)
    .map((b) => ({
      ...getToolMeta(b.source),
      cost: b.totalCost,
      share: totalCost > 0 ? ((b.totalCost / totalCost) * 100).toFixed(1) : "0",
    }));

  // Build tool summary for FAQ
  const toolSummary = activeTools
    .map((tool) => `${tool.name} (${tool.provider})`)
    .join(", ")
    .replace(/, ([^,]*)$/, ", and $1");

  const sorted = [...breakdown].sort((a, b) => b.totalCost - a.totalCost);
  const topSource = sorted[0];
  const topTool = topSource ? getToolMeta(topSource.source) : activeTools[0];

  const faqs = [
    {
      q: t("faqQ1"),
      a: t("faqA1", { toolCount, toolSummary }),
    },
    {
      q: t("faqQ2"),
      a: t("faqA2", {
        totalUsers,
        topToolName: topTool?.name ?? "the leading tool",
        topToolCost: topSource ? formatCurrency(topSource.totalCost) : "$0",
        topToolShare: topSource && totalCost > 0 ? ((topSource.totalCost / totalCost) * 100).toFixed(1) : "0",
      }),
    },
    {
      q: t("faqQ3"),
      a: t("faqA3", { toolList: listNames }),
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
      a: t("faqA6"),
    },
  ];

  const lastUpdated = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // ─── JSON-LD ──────────────────────────────────────────────────────────────

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Usage Statistics",
        item: `${BASE_URL}/stats`,
      },
      { "@type": "ListItem", position: 3, name: "Tool Comparison" },
    ],
  };

  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "AI Coding Tool Usage Comparison",
    description: `Side-by-side comparison of ${listNames} usage from ${totalUsers}+ developers. ${formatCurrency(totalCost)}+ total estimated cost, updated hourly.`,
    url: `${BASE_URL}/stats/tools`,
    dateModified: new Date().toISOString(),
    creator: {
      "@type": "Organization",
      name: "clawdboard",
      url: BASE_URL,
    },
    variableMeasured: [
      "Estimated cost per tool (USD)",
      "Token consumption per tool",
      "User count per tool",
      "Model breakdown per tool",
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

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
            href="/stats"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            {t("backToAllStats")}
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* ── Breadcrumb ─────────────────────────────────────────────── */}
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
            <li>
              <Link
                href="/stats"
                className="hover:text-accent transition-colors"
              >
                {t("breadcrumbStats")}
              </Link>
            </li>
            <li className="text-dim">/</li>
            <li className="text-foreground">{t("breadcrumbTools")}</li>
          </ol>
        </nav>

        {/* ── Sub-nav ─────────────────────────────────────────────── */}
        <StatsNav />

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="mb-10">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            <span className="text-accent mr-2">&gt;</span>
            {t("heroTitle")}
          </h1>
          <p className="mt-2 font-mono text-sm leading-relaxed text-muted max-w-3xl">
            {t.rich("heroDescription", {
              toolList: activeTools.map((tool, i) => {
                const prefix =
                  i > 0 && i === activeTools.length - 1
                    ? ", and "
                    : i > 0
                      ? ", "
                      : "";
                return prefix + tool.name;
              }).join(""),
              totalUsers: totalUsers.toLocaleString(),
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
            {totalUsers.toLocaleString()} developers have tracked{" "}
            {formatCurrency(totalCost)} in estimated AI coding spend and{" "}
            {formatTokens(totalTokens)} tokens across {toolCount} tool
            {toolCount !== 1 ? "s" : ""} on clawdboard.{" "}
            {rankedTools.map((rt, i) => (
              <span key={rt.slug}>
                {i === 0
                  ? `${rt.name} leads with ${rt.share}% of total spend (${formatCurrency(rt.cost)})`
                  : i < rankedTools.length - 1
                    ? `, followed by ${rt.name} at ${rt.share}% (${formatCurrency(rt.cost)})`
                    : `, and ${rt.name} at ${rt.share}% (${formatCurrency(rt.cost)})`}
              </span>
            ))}
            . Data is updated hourly from opt-in developer usage logs.
          </span>
          <p className="mt-2 font-mono text-[11px] text-dim">
            {t("lastUpdated", { lastUpdated })} &middot; {t("refreshedHourly")}
          </p>
        </div>

        {/* ── Community totals ──────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="totals-heading">
          <h2
            id="totals-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("totalsHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("totalsDescription")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label={t("totalEstimatedCost")}
              value={formatCurrency(totalCost)}
              sub={t("totalEstimatedCostSub")}
              accent
            />
            <StatCard
              label={t("totalTokens")}
              value={formatTokens(totalTokens)}
              sub={t("totalTokensSub")}
            />
            <StatCard
              label={t("toolsTracked")}
              value={String(toolCount)}
              sub={t("toolsTrackedSub", { count: toolCount })}
            />
          </div>
        </section>

        {/* ── Cost share bar ─────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="share-heading">
          <h2
            id="share-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("costShareHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("costShareDescription")}
          </p>
          <div className="rounded-lg border border-border bg-surface p-6">
            {totalCost > 0 && (
              <>
                <div className="flex h-6 w-full overflow-hidden rounded-full border border-border">
                  {activeTools.map((tool) => {
                    const b = breakdown.find((x) => x.source === tool.slug);
                    const share = b ? (b.totalCost / totalCost) * 100 : 0;
                    if (share === 0) return null;
                    return (
                      <div
                        key={tool.slug}
                        style={{
                          width: `${share}%`,
                          backgroundColor: tool.color,
                        }}
                        title={`${tool.name}: ${formatCurrency(b?.totalCost ?? 0)} (${share.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap justify-between mt-3 gap-3">
                  {activeTools.map((tool) => {
                    const b = breakdown.find((x) => x.source === tool.slug);
                    const share = b ? (b.totalCost / totalCost) * 100 : 0;
                    return (
                      <div
                        key={tool.slug}
                        className="flex items-center gap-2 font-mono text-xs text-muted"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: tool.color }}
                        />
                        <span>
                          {tool.name} — {share.toFixed(1)}% ({formatCurrency(b?.totalCost ?? 0)})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Per-tool cards ────────────────────────────────────────── */}
        <section className="mb-10" aria-labelledby="tools-heading">
          <h2
            id="tools-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("toolBreakdownHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("toolBreakdownDescription")}
          </p>
          <div className="space-y-4">
            {activeTools.map((tool, i) => {
              const detail = toolDetails[i];
              const topModels = toolModels[i]?.slice(0, 3) ?? [];
              if (!detail) return null;

              const cost = parseFloat(detail.totalCost);
              const avgCost = parseFloat(detail.avgCostPerUser);
              const medianCost = parseFloat(detail.medianCostPerUser);

              return (
                <div
                  key={tool.slug}
                  className="rounded-lg border border-border bg-surface overflow-hidden"
                >
                  {/* Tool header */}
                  <div
                    className="flex items-center gap-3 px-5 py-4 border-b border-border"
                    style={{
                      borderLeft: `3px solid ${tool.color}`,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-base font-bold text-foreground">
                        {tool.name}
                      </h3>
                      <p className="font-mono text-xs text-muted mt-0.5">
                        {tool.description}
                      </p>
                    </div>
                    <div
                      className="shrink-0 rounded-full px-3 py-1 font-mono text-xs font-semibold"
                      style={{
                        backgroundColor: `${tool.color}15`,
                        color: tool.color,
                      }}
                    >
                      {detail.costShare}%
                    </div>
                  </div>

                  {/* Tool stats */}
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                      <StatCard
                        label={t("estimatedCost")}
                        value={formatCurrency(cost)}
                        sub={t("costShareOfTotal", { costShare: detail.costShare })}
                      />
                      <StatCard
                        label={t("totalTokensLabel")}
                        value={formatTokens(detail.totalTokens)}
                        sub={t("tokenBreakdown", { input: formatTokens(detail.inputTokens), output: formatTokens(detail.outputTokens) })}
                      />
                      <StatCard
                        label={t("developers")}
                        value={detail.userCount.toLocaleString()}
                        sub={t("developerStats", { avg: formatCurrency(avgCost), med: formatCurrency(medianCost) })}
                      />
                      <StatCard
                        label={t("activeDays")}
                        value={detail.activeDays.toLocaleString()}
                        sub={
                          detail.firstSeen
                            ? t("activeDaysSince", { date: formatDate(detail.firstSeen) })
                            : t("activeDaysTracked")
                        }
                      />
                    </div>

                    {/* Data summary for LLM crawlers — visually hidden */}
                    <span className="sr-only">
                      {tool.name} accounts for {detail.costShare}% of
                      community spend on clawdboard with{" "}
                      {formatCurrency(cost)} in estimated API cost across{" "}
                      {detail.userCount.toLocaleString()} developer
                      {detail.userCount !== 1 ? "s" : ""}.
                      The average {tool.name} user has spent an estimated{" "}
                      {formatCurrency(avgCost)} (median: {formatCurrency(medianCost)}),
                      consuming {formatTokens(detail.totalTokens)} tokens
                      ({formatTokens(detail.inputTokens)} input,{" "}
                      {formatTokens(detail.outputTokens)} output).
                      {topModels.length > 0 && (
                        <> The most-used model{topModels.length > 1 ? "s" : ""} through {tool.name}{" "}
                        {topModels.length > 1 ? "are" : "is"}{" "}
                        {topModels
                          .map(
                            (m) =>
                              `${friendlyModelName(m.modelName)} (${m.costShare}% of ${tool.name} spend)`
                          )
                          .join(", ")
                          .replace(/, ([^,]*)$/, ", and $1")}
                        .</>
                      )}
                      {detail.firstSeen && (
                        <> Usage has been tracked since{" "}
                        {formatDate(detail.firstSeen)}.</>
                      )}
                    </span>

                    {/* Top models for this tool */}
                    {topModels.length > 0 && (
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-2">
                          {t("topModels")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {topModels.map((m) => {
                            const mSlug = m.modelName.replace(
                              /-\d{6,8}$/,
                              ""
                            );
                            return (
                              <Link
                                key={m.modelName}
                                href={`/stats/models/${mSlug}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-foreground"
                              >
                                <span className="font-medium">
                                  {friendlyModelName(m.modelName)}
                                </span>
                                <span className="text-dim">
                                  {m.costShare}%
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Daily cost trends ────────────────────────────────────── */}
        <section className="mb-12" aria-labelledby="trends-heading">
          <h2
            id="trends-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("trendsHeading")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("trendsDescription", { toolList: toolNameList(activeTools) })}
          </p>
          <ChartCard>
            <ToolComparisonChart data={comparisonTrends} />
          </ChartCard>
        </section>

        {/* ── Model breakdown per tool ─────────────────────────────── */}
        {activeTools.map((tool, i) => {
          const models = toolModels[i];
          if (!models || models.length === 0) return null;
          return (
            <section
              key={tool.slug}
              className="mb-10"
              aria-labelledby={`${tool.slug}-models-heading`}
            >
              <h2
                id={`${tool.slug}-models-heading`}
                className="text-xl font-semibold text-foreground mb-1"
              >
                <span className="text-accent mr-1.5">&gt;</span>
                {t("modelBreakdownHeading", { toolName: tool.name })}
              </h2>
              <p className="font-mono text-xs text-muted mb-4">
                {t("modelBreakdownDescription", { toolName: tool.name })}
              </p>
              <ChartCard>
                <ModelShareChart data={models} linkToModelPages />
              </ChartCard>
            </section>
          );
        })}

        {/* ── Divider: data zone → analysis zone ─────────────────── */}
        <div className="border-t border-border my-14" />

        {/* ── Analysis ─────────────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="analysis-heading"
        >
          <h2
            id="analysis-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            {t("analysisHeading")}
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              {t("analysisP1Start", { toolCount })}
              {activeTools.map((tool, i) => (
                <span key={tool.slug}>
                  {i > 0 && i < activeTools.length - 1 && ", "}
                  {i > 0 && i === activeTools.length - 1 && ", and "}
                  <strong className="text-foreground">{tool.name}</strong>
                  {" "}({tool.provider})
                </span>
              ))}
              .
            </p>
            {rankedTools.length > 1 && (
              <p>
                {t.rich("analysisCostRanking", {
                  leadingTool: rankedTools[0].name,
                  leadingShare: rankedTools[0].share,
                  strong: (chunks) => (
                    <strong className="text-foreground">{chunks}</strong>
                  ),
                })}
                {rankedTools.slice(1).map((rt, i) => (
                  <span key={rt.slug}>
                    {i > 0 &&
                      i < rankedTools.length - 2 &&
                      ", "}
                    {i > 0 &&
                      i === rankedTools.length - 2 &&
                      ", and "}
                    <strong className="text-foreground">{rt.name}</strong> (
                    {rt.share}%)
                  </span>
                ))}
                .
              </p>
            )}
            <p>
              {t("analysisCostExplanation")}
            </p>
            <p>
              {toolCount > 1
                ? t("analysisUniqueTracking", { toolCount })
                : t("analysisUniqueTrackingSingle")
              }
            </p>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────── */}
        <StatsFaq
          heading={t("faqHeading")}
          description={t("faqDescription")}
          faqs={faqs}
        />

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <StatsCta
          heading={t("ctaHeading")}
          description={t("ctaDescription", { toolList: toolNameList(activeTools) })}
          primaryLabel={t("ctaPrimaryLabel")}
          primaryHref="/"
          secondaryLabel={t("ctaSecondaryLabel")}
          secondaryHref="/stats"
        />
      </main>
    </div>
  );
}
