"use client";

import { useEffect, useRef, useState } from "react";
import type { RecapData } from "@/lib/db/schema";
import { RadialBurst } from "../visuals/RadialBurst";
import { AmbientParticles } from "../visuals/AmbientParticles";
import { formatUsd } from "@/lib/format";

interface SlideRankProps {
  data: RecapData;
}

/** Animated number counter */
function useCountUp(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    // Start counting after 300ms delay
    const timeout = setTimeout(() => {
      function step(ts: number) {
        if (!startTime.current) startTime.current = ts;
        const progress = Math.min((ts - startTime.current) / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }, 300);

    return () => clearTimeout(timeout);
  }, [target, duration]);

  return value;
}

function RankBadge({ tier }: { tier: RecapData["stateTier"] }) {
  if (tier === "podium") return null; // Medal shown instead
  if (tier === "top10") {
    return (
      <span className="inline-block rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-orange-400 animate-fade-in" style={{ animationDelay: "1600ms" }}>
        Top 10
      </span>
    );
  }
  if (tier === "top10pct") {
    return (
      <span className="inline-block rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-yellow-400 animate-fade-in" style={{ animationDelay: "1600ms" }}>
        Top 10%
      </span>
    );
  }
  return null;
}

function getMedalEmoji(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  return "";
}

function getRankGlow(tier: RecapData["stateTier"]): string {
  if (tier === "podium") return "drop-shadow-[0_0_30px_rgba(249,166,21,0.5)]";
  if (tier === "top10") return "drop-shadow-[0_0_20px_rgba(249,115,22,0.4)]";
  if (tier === "top10pct") return "drop-shadow-[0_0_15px_rgba(234,179,8,0.3)]";
  return "";
}

export function SlideRank({ data }: SlideRankProps) {
  const displayRank = useCountUp(data.rank, 1200);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Confetti for podium
  useEffect(() => {
    if (data.stateTier !== "podium") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    (async () => {
      try {
        const confettiModule = await import("canvas-confetti");
        if (cancelled) return;

        const confettiCreate =
          confettiModule.default?.create ?? confettiModule.create;
        if (!confettiCreate) return;

        const confetti = confettiCreate(canvas, {
          resize: true,
          useWorker: true,
        });

        // Wait for counter to finish
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;

        const colors =
          data.rank === 1
            ? ["#FFD700", "#FFA500", "#FF8C00", "#FFFFFF"]
            : data.rank === 2
              ? ["#C0C0C0", "#E8E8E8", "#A9A9A9", "#FFFFFF"]
              : ["#CD7F32", "#B8860B", "#DAA520", "#FFFFFF"];

        confetti({
          particleCount: 80,
          spread: 100,
          origin: { x: 0.5, y: 0.45 },
          colors,
          startVelocity: 30,
          gravity: 0.8,
          ticks: 150,
        });

        setTimeout(() => {
          if (cancelled) return;
          confetti({
            particleCount: 40,
            spread: 60,
            origin: { x: 0.3, y: 0.5 },
            colors,
            startVelocity: 20,
            gravity: 0.6,
            ticks: 100,
          });
          confetti({
            particleCount: 40,
            spread: 60,
            origin: { x: 0.7, y: 0.5 },
            colors,
            startVelocity: 20,
            gravity: 0.6,
            ticks: 100,
          });
        }, 400);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [data.stateTier, data.rank]);

  // Ember particles for top 10
  const showEmbers = data.stateTier === "top10";

  const rankDelta =
    data.previousRank !== null ? data.previousRank - data.rank : null;

  return (
    <div className="flex flex-col items-center text-center gap-5 relative">
      {/* Ambient particles */}
      <AmbientParticles
        count={12}
        color={
          data.stateTier === "podium"
            ? "rgba(255, 215, 0, 0.15)"
            : data.stateTier === "top10"
              ? "rgba(249, 115, 22, 0.12)"
              : "rgba(249, 166, 21, 0.08)"
        }
      />

      {/* Confetti canvas */}
      {data.stateTier === "podium" && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 -top-14 -left-6 -right-6 -bottom-8"
          style={{ width: "calc(100% + 48px)", height: "calc(100% + 88px)" }}
        />
      )}

      {/* Label */}
      <p className="font-mono text-xs text-white/40 uppercase tracking-widest animate-fade-in relative z-10">
        Your Rank
      </p>

      {/* Medal for podium */}
      {data.stateTier === "podium" && (
        <span
          className="text-5xl animate-fade-in relative z-10"
          style={{ animationDelay: "1600ms" }}
        >
          {getMedalEmoji(data.rank)}
        </span>
      )}

      {/* Ember effect for top 10 */}
      {showEmbers && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 rounded-full bg-orange-400/60 animate-ember"
              style={{
                left: `${15 + Math.random() * 70}%`,
                bottom: "25%",
                animationDelay: `${i * 0.25}s`,
                animationDuration: `${1.5 + Math.random()}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Radial burst behind rank number */}
      <RadialBurst tier={data.stateTier} />

      {/* The big number */}
      <div className={`relative z-10 ${getRankGlow(data.stateTier)}`}>
        <span className="font-display text-[96px] font-black leading-none text-white tabular-nums">
          #{displayRank || "\u00A0"}
        </span>
      </div>

      {/* Out of total */}
      <p
        className="font-mono text-sm text-white/40 animate-fade-in"
        style={{ animationDelay: "800ms" }}
      >
        out of {data.totalUsers} developers
      </p>

      {/* Rank movement */}
      {rankDelta !== null && rankDelta !== 0 && (
        <div
          className="animate-fade-in"
          style={{ animationDelay: "1200ms" }}
        >
          {rankDelta > 0 ? (
            <span className="inline-flex items-center gap-1 font-mono text-sm text-emerald-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
              {rankDelta} spot{rankDelta > 1 ? "s" : ""} up
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-mono text-sm text-white/30">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {Math.abs(rankDelta)} spot{Math.abs(rankDelta) > 1 ? "s" : ""} down
            </span>
          )}
        </div>
      )}

      {/* Percentile for non-low tiers */}
      {data.stateTier !== "low" && data.stateTier !== "empty" && (
        <p
          className="font-mono text-xs text-white/30 animate-fade-in"
          style={{ animationDelay: "1400ms" }}
        >
          Top {Math.max(1, Math.round(100 - data.percentile))}% of all users
        </p>
      )}

      {/* Low state: frame as percentile positively */}
      {data.stateTier === "low" && (
        <p
          className="font-mono text-xs text-white/30 animate-fade-in"
          style={{ animationDelay: "1400ms" }}
        >
          Top {Math.max(1, Math.round(100 - data.percentile))}% of developers
        </p>
      )}

      {/* Tier badge */}
      <RankBadge tier={data.stateTier} />

      {/* Rival nudge */}
      {data.rivalUsername && data.rivalGap !== null && (
        <div
          className="mt-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 animate-fade-in max-w-[300px]"
          style={{ animationDelay: "1800ms" }}
        >
          {data.stateTier === "low" ? (
            // Milestone-based for low tiers
            <p className="font-mono text-xs text-white/60">
              Climb {Math.ceil(data.totalUsers * 0.5) - data.rank > 0 ? `${Math.ceil(data.totalUsers * 0.5) - data.rank} more spots` : "a few spots"} to break the{" "}
              <span className="text-accent">top 50%</span>
            </p>
          ) : (
            <p className="font-mono text-xs text-white/60">
              <span className="text-accent font-semibold">
                {formatUsd(data.rivalGap)}
              </span>{" "}
              behind{" "}
              <span className="text-white/80">@{data.rivalUsername}</span> for{" "}
              <span className="text-white/80">#{data.rivalRank}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
