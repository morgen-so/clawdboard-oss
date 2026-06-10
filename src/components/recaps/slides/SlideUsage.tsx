"use client";

import type { RecapData } from "@/lib/db/schema";
import { DonutChart } from "../visuals/DonutChart";
import { AmbientParticles } from "../visuals/AmbientParticles";
import { formatTokensCompact, formatUsd } from "@/lib/format";

interface SlideUsageProps {
  data: RecapData;
  type: string;
}

const DONUT_COLORS = ["#F9A615", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899"];

function DeltaBadge({
  value,
  type,
  delay,
}: {
  value: number | null;
  type: "currency" | "tokens";
  delay: string;
}) {
  if (value === null) return null;

  const isPositive = value > 0;
  const formatted =
    type === "currency"
      ? formatUsd(Math.abs(value))
      : formatTokensCompact(Math.abs(value));

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-xs animate-fade-in ${
        isPositive ? "text-emerald-400" : "text-white/30"
      }`}
      style={{ animationDelay: delay }}
    >
      {isPositive ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      ) : value < 0 ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      ) : null}
      {value === 0 ? "no change" : formatted}
    </span>
  );
}

export function SlideUsage({ data }: SlideUsageProps) {
  const donutSegments = data.modelBreakdown.map((m, i) => ({
    name: m.name,
    percentage: m.percentage,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  return (
    <div className="relative flex flex-col items-center text-center gap-6">
      {/* Ambient particles */}
      <AmbientParticles count={10} color="rgba(249, 166, 21, 0.06)" />

      {/* Spend + Tokens row */}
      <div className="relative z-10 flex items-start gap-8">
        {/* Spend */}
        <div className="flex flex-col items-center gap-1.5">
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest animate-fade-in">
            Spend
          </p>
          <p
            className="font-display text-3xl font-bold text-white animate-fade-in"
            style={{ animationDelay: "200ms" }}
          >
            {formatUsd(data.totalCost)}
          </p>
          <DeltaBadge value={data.costDelta} type="currency" delay="500ms" />
        </div>

        {/* Divider */}
        <div
          className="h-14 w-px bg-white/10 animate-fade-in mt-4"
          style={{ animationDelay: "300ms" }}
        />

        {/* Tokens */}
        <div className="flex flex-col items-center gap-1.5">
          <p
            className="font-mono text-[10px] text-white/40 uppercase tracking-widest animate-fade-in"
            style={{ animationDelay: "400ms" }}
          >
            Tokens
          </p>
          <p
            className="font-display text-3xl font-bold text-white animate-fade-in"
            style={{ animationDelay: "600ms" }}
          >
            {formatTokensCompact(data.totalTokens)}
          </p>
          <DeltaBadge value={data.tokensDelta} type="tokens" delay="800ms" />
        </div>
      </div>

      {/* Donut chart for model breakdown */}
      {donutSegments.length > 0 && (
        <div
          className="relative z-10 animate-fade-in"
          style={{ animationDelay: "1000ms" }}
        >
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-3">
            Model Mix
          </p>
          <DonutChart segments={donutSegments} size={150} strokeWidth={16} />
        </div>
      )}

      {/* Legend */}
      {donutSegments.length > 0 && (
        <div
          className="relative z-10 flex flex-wrap justify-center gap-x-4 gap-y-1.5 animate-fade-in"
          style={{ animationDelay: "2000ms" }}
        >
          {donutSegments.slice(0, 4).map((m, i) => (
            <div key={m.name} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="font-mono text-[10px] text-white/50">
                {m.name}{" "}
                <span className="text-white/30">({m.percentage}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
