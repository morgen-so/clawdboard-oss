"use client";

import { useState } from "react";
import { RecapStories } from "./RecapStories";
import type { RecapRow } from "@/lib/db/recaps";
import type { RecapData } from "@/lib/db/schema";

interface RecapStripProps {
  recaps: RecapRow[];
}

function formatPeriod(type: string, periodStart: string): string {
  const d = new Date(periodStart + "T12:00:00Z");
  if (type === "weekly") {
    return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTokens(count: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

function getMedalEmoji(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  return "";
}

function getTierAccent(tier: RecapData["stateTier"]): string {
  switch (tier) {
    case "podium":
      return "border-yellow-500/30 shadow-[0_0_12px_rgba(255,215,0,0.08)]";
    case "top10":
      return "border-orange-500/25";
    case "top10pct":
      return "border-accent/20";
    default:
      return "border-border";
  }
}

function getTierBg(tier: RecapData["stateTier"]): string {
  switch (tier) {
    case "podium":
      return "bg-gradient-to-br from-yellow-500/8 via-surface to-surface";
    case "top10":
      return "bg-gradient-to-br from-orange-500/6 via-surface to-surface";
    case "top10pct":
      return "bg-gradient-to-br from-accent/5 via-surface to-surface";
    default:
      return "bg-surface";
  }
}

// ─── Compact card (used in scrollable strip for 3+ recaps) ──────────────────

function RecapCard({
  recap,
  onClick,
}: {
  recap: RecapRow;
  onClick: () => void;
}) {
  const data = recap.data;

  return (
    <button
      onClick={onClick}
      className={`group relative flex-shrink-0 w-[160px] rounded-xl border p-4 transition-all hover:scale-[1.02] hover:border-accent/40 cursor-pointer ${getTierAccent(data.stateTier)} ${getTierBg(data.stateTier)}`}
    >
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
        {recap.type === "weekly" ? "weekly" : "monthly"}
      </span>
      <p className="font-mono text-[11px] text-foreground/70 mt-1 leading-tight">
        {formatPeriod(recap.type, recap.periodStart)}
      </p>
      <div className="mt-3 flex items-baseline gap-1.5">
        {data.stateTier === "podium" && (
          <span className="text-sm">{getMedalEmoji(data.rank)}</span>
        )}
        <span className="font-display text-2xl font-black text-foreground">
          #{data.rank}
        </span>
      </div>
      <p className="font-mono text-[11px] text-muted mt-1">
        {formatCost(data.totalCost)}
      </p>
      {data.stateTier !== "empty" && data.stateTier !== "low" && data.stateTier !== "normal" && (
        <div className="absolute top-3 right-3">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              data.stateTier === "podium"
                ? "bg-yellow-400"
                : data.stateTier === "top10"
                  ? "bg-orange-400"
                  : "bg-accent"
            }`}
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-muted group-hover:text-accent transition-colors">
        <span className="font-mono text-[9px]">View recap</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}

// ─── Wide card (used inline for 1-2 recaps) ─────────────────────────────────

function RecapCardWide({
  recap,
  onClick,
}: {
  recap: RecapRow;
  onClick: () => void;
}) {
  const data = recap.data;
  const rankDelta =
    data.previousRank !== null ? data.previousRank - data.rank : null;

  return (
    <button
      onClick={onClick}
      className={`group relative flex-1 min-w-0 rounded-xl border p-5 transition-all hover:scale-[1.01] hover:border-accent/40 cursor-pointer text-left ${getTierAccent(data.stateTier)} ${getTierBg(data.stateTier)}`}
    >
      <div className="flex items-start justify-between">
        {/* Left: period + type */}
        <div>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
              {recap.type === "weekly" ? "weekly recap" : "monthly recap"}
            </span>
            {data.stateTier !== "empty" && data.stateTier !== "low" && data.stateTier !== "normal" && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  data.stateTier === "podium"
                    ? "bg-yellow-400"
                    : data.stateTier === "top10"
                      ? "bg-orange-400"
                      : "bg-accent"
                }`}
              />
            )}
          </span>
          <p className="font-mono text-sm text-foreground/70 mt-0.5">
            {formatPeriod(recap.type, recap.periodStart)}
          </p>
        </div>

        {/* Right: view CTA */}
        <div className="flex items-center gap-1 text-muted group-hover:text-accent transition-colors shrink-0">
          <span className="font-mono text-[10px]">View recap</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center gap-4 overflow-hidden">
        {/* Rank */}
        <div className="flex items-baseline gap-1.5 shrink-0">
          {data.stateTier === "podium" && (
            <span className="text-base">{getMedalEmoji(data.rank)}</span>
          )}
          <span className="font-display text-3xl font-black text-foreground">
            #{data.rank}
          </span>
          {rankDelta !== null && rankDelta !== 0 && (
            <span
              className={`font-mono text-xs ${
                rankDelta > 0 ? "text-emerald-400" : "text-muted"
              }`}
            >
              {rankDelta > 0 ? "\u2191" : "\u2193"}
              {Math.abs(rankDelta)}
            </span>
          )}
        </div>

        <div className="h-8 w-px bg-border shrink-0" />

        {/* Cost */}
        <div className="shrink-0">
          <p className="font-mono text-[10px] text-muted">Spend</p>
          <p className="font-display text-lg font-bold text-foreground">
            {formatCost(data.totalCost)}
          </p>
        </div>

        <div className="h-8 w-px bg-border shrink-0" />

        {/* Tokens */}
        <div className="shrink-0">
          <p className="font-mono text-[10px] text-muted">Tokens</p>
          <p className="font-display text-lg font-bold text-foreground">
            {formatTokens(data.totalTokens)}
          </p>
        </div>

        <div className="h-8 w-px bg-border shrink-0" />

        {/* Streak */}
        <div className="shrink-0">
          <p className="font-mono text-[10px] text-muted">Streak</p>
          <p className="font-display text-lg font-bold text-accent">
            {data.currentStreak}d
          </p>
        </div>

        {/* Top model — hidden when space is tight */}
        {data.topModel && (
          <>
            <div className="h-8 w-px bg-border shrink-0 hidden lg:block" />
            <div className="hidden lg:block min-w-0">
              <p className="font-mono text-[10px] text-muted">Top Model</p>
              <p className="font-mono text-xs text-foreground/70 truncate">
                {data.topModel.name}
              </p>
            </div>
          </>
        )}
      </div>

    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function RecapStrip({ recaps }: RecapStripProps) {
  const [activeRecap, setActiveRecap] = useState<RecapRow | null>(null);

  if (recaps.length === 0) return null;

  const isCompact = recaps.length >= 3;

  return (
    <>
      <div className="space-y-2">
        <h3 className="font-mono text-xs text-muted uppercase tracking-widest px-1">
          Recaps
        </h3>

        {isCompact ? (
          // Scrollable strip for 3+ recaps — right-edge mask hints at
          // overflow so users know they can scroll.
          <div
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
            style={{
              maskImage:
                "linear-gradient(to right, black 0, black calc(100% - 48px), transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, black 0, black calc(100% - 48px), transparent 100%)",
            }}
          >
            {recaps.map((recap) => (
              <RecapCard
                key={recap.id}
                recap={recap}
                onClick={() => setActiveRecap(recap)}
              />
            ))}
          </div>
        ) : (
          // Inline wide cards for 1-2 recaps
          <div className="flex gap-3">
            {recaps.map((recap) => (
              <RecapCardWide
                key={recap.id}
                recap={recap}
                onClick={() => setActiveRecap(recap)}
              />
            ))}
          </div>
        )}
      </div>

      {activeRecap && (
        <RecapStories
          recap={activeRecap}
          onClose={() => setActiveRecap(null)}
        />
      )}
    </>
  );
}
