"use client";

import type { RecapData } from "@/lib/db/schema";
import { formatDateRange } from "@/lib/format";

interface SlideEmptyProps {
  data: RecapData;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
}

export function SlideEmpty({
  data,
  periodLabel,
  periodStart,
  periodEnd,
}: SlideEmptyProps) {
  const rankDrop =
    data.previousRank !== null && data.previousRank < data.rank
      ? data.rank - data.previousRank
      : null;

  return (
    <div className="flex flex-col items-center text-center gap-6">
      {/* Period badge */}
      <span className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/30 animate-fade-in">
        {periodLabel}
      </span>

      {/* Date range */}
      <p className="font-mono text-xs text-white/20 animate-fade-in" style={{ animationDelay: "200ms" }}>
        {formatDateRange(periodStart, periodEnd)}
      </p>

      {/* Idle visual */}
      <div
        className="text-5xl animate-fade-in"
        style={{ animationDelay: "400ms" }}
      >
        {"\uD83D\uDCA4"}
      </div>

      {/* Message */}
      <p
        className="font-mono text-lg text-white/50 animate-fade-in max-w-[280px]"
        style={{ animationDelay: "600ms" }}
      >
        You took a break this {periodLabel.includes("Weekly") ? "week" : "month"}.
      </p>

      {/* Rank consequence */}
      {rankDrop && rankDrop > 0 && (
        <div
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 animate-fade-in max-w-[300px]"
          style={{ animationDelay: "900ms" }}
        >
          <p className="font-mono text-xs text-white/50">
            You dropped from{" "}
            <span className="text-white/80">#{data.previousRank}</span> to{" "}
            <span className="text-white/80">#{data.rank}</span>
          </p>
          {data.rivalUsername && (
            <p className="font-mono text-[10px] text-white/30 mt-1">
              @{data.rivalUsername} and others passed you
            </p>
          )}
        </div>
      )}

      {/* CTA */}
      <p
        className="font-mono text-[10px] text-white/20 animate-fade-in"
        style={{ animationDelay: "1200ms" }}
      >
        tap to dismiss
      </p>
    </div>
  );
}
