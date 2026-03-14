import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { Header } from "@/components/layout/Header";
import {
  getModelDetailStatsCached,
  getModelDailyTrendsCached,
  getModelStatsCached,
  getDistinctModelSlugsCached,
} from "@/lib/db/cached";
import { ModelTrendChart } from "@/components/stats/ModelTrendChart";
import { StatCard } from "@/components/stats/StatCard";
import { ChartCard } from "@/components/stats/ChartCard";
import { StatsFaq } from "@/components/stats/StatsFaq";
import { StatsCta } from "@/components/stats/StatsCta";
import { StatsNav } from "@/components/stats/StatsNav";
import { friendlyModelName } from "@/lib/chart-utils";
import { getModelSeoMeta } from "@/lib/models";
import { getTranslations } from "next-intl/server";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ model: string }>;
}

// ─── Static params for build-time generation ────────────────────────────────

export async function generateStaticParams() {
  const slugs = await getDistinctModelSlugsCached();
  return slugs.map((model) => ({ model }));
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

function tokenRatio(input: number, output: number): string {
  const total = input + output;
  if (total === 0) return "0% / 0%";
  return `${((input / total) * 100).toFixed(0)}% input / ${((output / total) * 100).toFixed(0)}% output`;
}

// ─── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { model: slug } = await params;
  const detail = await getModelDetailStatsCached(slug);

  if (!detail) {
    return { title: "Model Not Found" };
  }

  const displayName = friendlyModelName(detail.rawModelIds[0] ?? slug);
  const seo = getModelSeoMeta(slug);
  const cost = formatCurrency(parseFloat(detail.totalCost));
  const users = detail.userCount;

  const title = `${displayName} Usage & Cost Statistics — Real Data from ${users} Developers`;
  const description = `${displayName} is ${seo.description}. ${users} developers have used ${displayName} with ${cost}+ in estimated API cost and ${formatTokens(detail.totalTokens)}+ tokens consumed. Live data from clawdboard, updated hourly.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/stats/models/${slug}` },
    openGraph: {
      title: `${displayName} Usage Statistics — ${users} Developers, ${cost}+ Spend`,
      description,
      type: "website",
      url: `${BASE_URL}/stats/models/${slug}`,
    },
    keywords: [
      ...seo.keywords,
      `${displayName.toLowerCase()} cost`,
      `${displayName.toLowerCase()} usage statistics`,
      `${displayName.toLowerCase()} tokens`,
      `how much does ${displayName.toLowerCase()} cost`,
    ],
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function ModelPage({ params }: PageProps) {
  const t = await getTranslations("statsModel");
  const { model: slug } = await params;

  const [detail, trends, allModels] = await Promise.all([
    getModelDetailStatsCached(slug),
    getModelDailyTrendsCached(slug),
    getModelStatsCached(),
  ]);

  if (!detail) notFound();

  const displayName = friendlyModelName(detail.rawModelIds[0] ?? slug);
  const seo = getModelSeoMeta(slug);

  // Group by slug and sum costs for ranking
  const slugCosts = new Map<string, number>();
  for (const m of allModels) {
    const s = m.modelName.replace(/-\d{6,8}$/, "");
    slugCosts.set(s, (slugCosts.get(s) ?? 0) + parseFloat(m.totalCost));
  }
  const rankedSlugs = [...slugCosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  const totalModels = rankedSlugs.length;
  const rank = rankedSlugs.indexOf(slug) + 1 || totalModels;

  // Find related models (other models from same provider, excluding self)
  const relatedModels = allModels
    .filter((m) => {
      const s = m.modelName.replace(/-\d{6,8}$/, "");
      if (s === slug) return false;
      const meta = getModelSeoMeta(s);
      return meta.provider === seo.provider;
    })
    .slice(0, 4);

  const totalCost = parseFloat(detail.totalCost);
  const avgCost = parseFloat(detail.avgCostPerUser);
  const medianCost = parseFloat(detail.medianCostPerUser);
  const costPerToken = detail.totalTokens > 0
    ? totalCost / detail.totalTokens
    : 0;

  const faqs = [
    {
      q: t("faqQ1", { modelName: displayName }),
      a: t("faqA1", {
        userCount: detail.userCount,
        modelName: displayName,
        avgCost: formatCurrency(avgCost),
        medianCost: formatCurrency(medianCost),
        provider: seo.provider,
      }),
    },
    {
      q: t("faqQ2", { modelName: displayName }),
      a: t("faqA2", {
        modelName: displayName,
        rank,
        totalModels,
        costShare: detail.costShare,
        userCount: detail.userCount,
      }),
    },
    {
      q: t("faqQ3", { modelName: displayName }),
      a: t("faqA3", {
        modelName: displayName,
        modelDescription: seo.description,
        tokenRatioText: tokenRatio(detail.inputTokens, detail.outputTokens),
      }),
    },
    {
      q: t("faqQ4", { modelName: displayName }),
      a: t("faqA4"),
    },
    {
      q: t("faqQ5", { modelName: displayName }),
      a: detail.firstSeen
        ? t("faqA5", { modelName: displayName, trackedSince: formatDate(detail.firstSeen) })
        : t("faqA5NoDate", { modelName: displayName }),
    },
  ];

  // ─── JSON-LD ────────────────────────────────────────────────────────────────

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
      { "@type": "ListItem", position: 3, name: `${displayName} Statistics` },
    ],
  };

  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${displayName} Coding Usage Statistics`,
    description: `Usage statistics for ${displayName} across ${detail.userCount} developers — estimated cost ${formatCurrency(totalCost)}+, ${formatTokens(detail.totalTokens)}+ tokens consumed. Updated hourly from opt-in developer usage logs.`,
    url: `${BASE_URL}/stats/models/${slug}`,
    dateModified: new Date().toISOString(),
    temporalCoverage: detail.firstSeen
      ? `${detail.firstSeen}/..`
      : "2024-01-01/..",
    creator: {
      "@type": "Organization",
      name: "clawdboard",
      url: BASE_URL,
    },
    variableMeasured: [
      `${displayName} estimated cost (USD)`,
      `${displayName} token consumption`,
      `${displayName} user count`,
      `${displayName} cost share`,
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

  const lastUpdated = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // Tier badge colors
  const tierColors: Record<string, string> = {
    flagship: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    fast: "text-blue-400 border-blue-400/30 bg-blue-400/10",
    efficient: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
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
        subtitle={t("subtitle", { modelName: displayName.toLowerCase() })}
        rightContent={
          <Link
            href="/stats"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            {t("backToAllModels")}
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* ── Breadcrumb ─────────────────────────────────────────────── */}
        <nav className="mb-6 font-mono text-xs text-muted" aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-accent transition-colors">
                {t("breadcrumbHome")}
              </Link>
            </li>
            <li className="text-dim">/</li>
            <li>
              <Link href="/stats" className="hover:text-accent transition-colors">
                {t("breadcrumbStats")}
              </Link>
            </li>
            <li className="text-dim">/</li>
            <li className="text-foreground">{displayName.toLowerCase()}</li>
          </ol>
        </nav>

        {/* ── Sub-nav ─────────────────────────────────────────────── */}
        <StatsNav />

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              <span className="text-accent mr-2">&gt;</span>
              {t("heroTitle", { modelName: displayName })}
            </h1>
            {seo.tier && tierColors[seo.tier] && (
              <span
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tierColors[seo.tier]}`}
              >
                {seo.tier}
              </span>
            )}
          </div>
          <p className="mt-2 font-mono text-sm leading-relaxed text-muted max-w-3xl">
            {t.rich("heroDescription", {
              modelName: displayName,
              userCount: detail.userCount.toLocaleString(),
              modelDescription: seo.description,
              provider: seo.provider,
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
            {displayName} ranks #{rank} out of {totalModels} tracked AI coding
            models on clawdboard, accounting for {detail.costShare}% of total
            community spend. {detail.userCount.toLocaleString()} developer
            {detail.userCount !== 1 ? "s have" : " has"} used {displayName},{" "}
            generating {formatCurrency(totalCost)} in estimated API cost and{" "}
            {formatTokens(detail.totalTokens)} tokens
            ({formatTokens(detail.inputTokens)} input,{" "}
            {formatTokens(detail.outputTokens)} output).
            The average estimated cost per developer is{" "}
            {formatCurrency(avgCost)} (median: {formatCurrency(medianCost)}).
            {detail.firstSeen && (
              <> {displayName} has been tracked on clawdboard since{" "}
              {formatDate(detail.firstSeen)}.</>
            )}{" "}
            Data is updated hourly from opt-in developer usage logs.
          </span>
          <p className="mt-2 font-mono text-[11px] text-dim">
            {t("lastUpdated", { lastUpdated })} &middot; {t("refreshedHourly")}
            {detail.firstSeen && (
              <> &middot; {t("trackedSince", { date: formatDate(detail.firstSeen) })}</>
            )}
          </p>
        </div>

        {/* ── Key metrics — headline row ──────────────────────────── */}
        <section className="mb-10" aria-labelledby="overview-heading">
          <h2
            id="overview-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("overviewHeading", { modelName: displayName })}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("overviewDescription", { modelName: displayName, userCount: detail.userCount })}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
            <StatCard
              label={t("totalEstimatedCost")}
              value={formatCurrency(totalCost)}
              sub={t("costShareSub", { costShare: detail.costShare })}
              accent
            />
            <StatCard
              label={t("totalTokens")}
              value={formatTokens(detail.totalTokens)}
              sub={tokenRatio(detail.inputTokens, detail.outputTokens)}
            />
            <StatCard
              label={t("developersLabel")}
              value={detail.userCount.toLocaleString()}
              sub={t("developersSub", { modelName: displayName })}
            />
            <StatCard
              label={t("modelRank")}
              value={`#${rank}`}
              sub={t("modelRankSub", { totalModels })}
            />
          </div>

          {/* Detail metrics row — separated with label */}
          <p className="font-mono text-[10px] uppercase tracking-wider text-dim mt-5 mb-2">
            {t("detailedBreakdown")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label={t("avgCostPerDeveloper")}
              value={formatCurrency(avgCost)}
              sub={t("medianSub", { medianCost: formatCurrency(medianCost) })}
            />
            <StatCard
              label={t("inputTokens")}
              value={formatTokens(detail.inputTokens)}
              sub={t("inputTokensSub")}
            />
            <StatCard
              label={t("outputTokens")}
              value={formatTokens(detail.outputTokens)}
              sub={t("outputTokensSub")}
            />
            <StatCard
              label={t("avgCostPerToken")}
              value={
                costPerToken > 0
                  ? `$${costPerToken.toFixed(6)}`
                  : "—"
              }
              sub={t("avgCostPerTokenSub")}
            />
          </div>
        </section>

        {/* ── Daily usage trends ─────────────────────────────────── */}
        <section className="mb-12" aria-labelledby="trends-heading">
          <h2
            id="trends-heading"
            className="text-xl font-semibold text-foreground mb-1"
          >
            <span className="text-accent mr-1.5">&gt;</span>
            {t("trendsHeading", { modelName: displayName })}
          </h2>
          <p className="font-mono text-xs text-muted mb-4">
            {t("trendsDescription", { modelName: displayName })}
          </p>
          <ChartCard>
            <ModelTrendChart data={trends} modelName={displayName} />
          </ChartCard>
        </section>

        {/* ── Divider: data zone → analysis zone ─────────────────── */}
        <div className="border-t border-border my-14" />

        {/* ── Token breakdown ────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="tokens-heading"
        >
          <h2
            id="tokens-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            {t("tokenBreakdownHeading", { modelName: displayName })}
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              {t.rich("tokenBreakdownP1", {
                modelName: displayName,
                totalTokens: formatTokens(detail.totalTokens),
                inputTokens: formatTokens(detail.inputTokens),
                outputTokens: formatTokens(detail.outputTokens),
                strong: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
            </p>
            {(detail.cacheCreationTokens > 0 ||
              detail.cacheReadTokens > 0) && (
              <p>
                {t.rich("tokenBreakdownCache", {
                  cacheCreationTokens: formatTokens(detail.cacheCreationTokens),
                  cacheReadTokens: formatTokens(detail.cacheReadTokens),
                  strong: (chunks) => (
                    <strong className="text-foreground">{chunks}</strong>
                  ),
                })}
              </p>
            )}
            <p>
              {detail.inputTokens > detail.outputTokens
                ? t("tokenRatioHighInput")
                : t("tokenRatioHighOutput")}
              .
            </p>

            {/* Visual token bar */}
            {detail.totalTokens > 0 && (() => {
              const inputPct = (detail.inputTokens / detail.totalTokens) * 100;
              const outputPct = (detail.outputTokens / detail.totalTokens) * 100;
              return (
                <div className="mt-4">
                  <div className="flex h-7 w-full overflow-hidden rounded-full border border-border text-[10px] font-semibold">
                    <div
                      className="bg-accent flex items-center justify-center text-background"
                      style={{ width: `${inputPct}%` }}
                      title={`Input: ${formatTokens(detail.inputTokens)}`}
                    >
                      {inputPct > 15 && `${inputPct.toFixed(0)}% in`}
                    </div>
                    <div
                      className="bg-blue-500 flex items-center justify-center text-background"
                      style={{ width: `${outputPct}%` }}
                      title={`Output: ${formatTokens(detail.outputTokens)}`}
                    >
                      {outputPct > 15 && `${outputPct.toFixed(0)}% out`}
                    </div>
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-accent" />
                      {t("tokenBarInputLabel", { percent: inputPct.toFixed(0) })}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                      {t("tokenBarOutputLabel", { percent: outputPct.toFixed(0) })}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* ── Cost analysis ──────────────────────────────────────── */}
        <section
          className="mb-10 rounded-lg border border-border bg-surface p-6"
          aria-labelledby="cost-heading"
        >
          <h2
            id="cost-heading"
            className="text-lg font-semibold text-foreground mb-3"
          >
            {t("costAnalysisHeading", { modelName: displayName })}
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-muted">
            <p>
              {t.rich("costAnalysisP1", {
                userCount: detail.userCount,
                modelName: displayName,
                avgCost: formatCurrency(avgCost),
                medianCost: formatCurrency(medianCost),
                strong: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
            </p>
            <p>
              {t.rich("costAnalysisP2", {
                modelName: displayName,
                costShare: detail.costShare,
                totalModels,
                rank,
                strong: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
              {seo.tier === "flagship" && t("costAnalysisP2Flagship")}
              {seo.tier === "fast" && t("costAnalysisP2Fast")}
            </p>
            <p>
              {t("costAnalysisP3", { modelName: displayName })}
            </p>
          </div>
        </section>

        {/* ── Related models ─────────────────────────────────────── */}
        {relatedModels.length > 0 && (
          <section className="mb-10" aria-labelledby="related-heading">
            <h2
              id="related-heading"
              className="text-xl font-semibold text-foreground mb-1"
            >
              <span className="text-accent mr-1.5">&gt;</span>
              {t("relatedModelsHeading", { provider: seo.provider })}
            </h2>
            <p className="font-mono text-xs text-muted mb-4">
              {t("relatedModelsDescription", { modelName: displayName, provider: seo.provider })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {relatedModels.map((m) => {
                const mSlug = m.modelName.replace(/-\d{6,8}$/, "");
                const mName = friendlyModelName(m.modelName);
                const mCost = parseFloat(m.totalCost);
                const mSeo = getModelSeoMeta(mSlug);
                return (
                  <Link
                    key={m.modelName}
                    href={`/stats/models/${mSlug}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-medium text-foreground truncate">
                          {mName}
                        </p>
                        {mSeo.tier && tierColors[mSeo.tier] && (
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider ${tierColors[mSeo.tier]}`}
                          >
                            {mSeo.tier}
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-xs text-muted">
                        {formatCurrency(mCost)} &middot; {t("relatedModelSpend", { costShare: m.costShare })} &middot; {t("relatedModelUser", { count: m.userCount })}
                      </p>
                    </div>
                    <span className="text-muted text-xs">&rarr;</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <StatsFaq
          heading={t("faqHeading", { modelName: displayName })}
          description={t("faqDescription", { modelName: displayName })}
          faqs={faqs}
        />

        {/* ── CTA ────────────────────────────────────────────────── */}
        <StatsCta
          heading={t("ctaHeading", { modelName: displayName })}
          description={t("ctaDescription", { modelName: displayName })}
          primaryLabel={t("ctaPrimaryLabel")}
          primaryHref="/"
          secondaryLabel={t("ctaSecondaryLabel")}
          secondaryHref="/stats"
        />
      </main>
    </div>
  );
}
