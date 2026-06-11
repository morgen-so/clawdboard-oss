"use client";

import { useTranslations } from "next-intl";
import type { RecapData } from "@/lib/db/schema";
import { GenerativePattern } from "../visuals/GenerativePattern";
import { AmbientParticles } from "../visuals/AmbientParticles";
import { formatDateRange } from "@/lib/format";

interface SlideHookProps {
  data: RecapData;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
}

function getTeaser(
  data: RecapData,
  t: ReturnType<typeof useTranslations<"recaps">>
): string {
  if (data.stateTier === "podium") {
    if (data.rank === 1) return t("hook.dominated");
    return t("hook.podium");
  }
  if (data.stateTier === "top10") return t("hook.top10");
  if (data.previousRank && data.previousRank > data.rank) {
    return t("hook.climbed", { count: data.previousRank - data.rank });
  }
  if (data.previousRank && data.previousRank < data.rank) {
    return t("hook.reclaim");
  }
  if (data.stateTier === "top10pct") return t("hook.elite");
  return t("hook.default");
}

export function SlideHook({
  data,
  periodLabel,
  periodStart,
  periodEnd,
}: SlideHookProps) {
  const t = useTranslations("recaps");

  return (
    <div className="relative flex flex-col items-center text-center gap-6">
      {/* Generative background pattern */}
      <GenerativePattern
        rank={data.rank}
        totalCost={data.totalCost}
        streak={data.currentStreak}
        tier={data.stateTier}
        variant="geometric"
      />

      {/* Ambient particles */}
      <AmbientParticles
        count={15}
        color={
          data.stateTier === "podium"
            ? "rgba(255, 215, 0, 0.12)"
            : "rgba(249, 166, 21, 0.08)"
        }
      />

      {/* Period badge */}
      <div className="animate-fade-in relative z-10">
        <span className="inline-block rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-accent">
          {periodLabel}
        </span>
      </div>

      {/* Date range */}
      <p
        className="font-mono text-sm text-white/40 animate-fade-in relative z-10"
        style={{ animationDelay: "200ms" }}
      >
        {formatDateRange(periodStart, periodEnd)}
      </p>

      {/* Logo mark */}
      <div
        className="animate-fade-in relative z-10"
        style={{ animationDelay: "400ms" }}
      >
        <span className="font-display text-4xl font-bold text-white tracking-tight">
          <span className="text-accent">$</span> clawdboard
        </span>
      </div>

      {/* Teaser */}
      <p
        className="font-mono text-lg text-white/80 animate-fade-in max-w-[280px] relative z-10"
        style={{ animationDelay: "700ms" }}
      >
        {getTeaser(data, t)}
      </p>

      {/* Tap hint */}
      <p
        className="font-mono text-[10px] text-white/20 animate-fade-in relative z-10"
        style={{ animationDelay: "1200ms" }}
      >
        {t("hook.tapToContinue")}
      </p>
    </div>
  );
}
