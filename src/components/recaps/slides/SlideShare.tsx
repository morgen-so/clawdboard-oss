"use client";

import { useState, useRef } from "react";
import type { RecapData } from "@/lib/db/schema";
import {
  buildTwitterIntentUrl,
  buildLinkedInShareUrl,
} from "@/lib/share";
import {
  formatDateRange,
  formatTokensCompact,
  formatUsdWhole,
} from "@/lib/format";
import { CheckIcon, DownloadIcon, LinkedInIcon, XIcon } from "@/components/icons/CommonIcons";

interface SlideShareProps {
  recapId: string;
  data: RecapData;
  type: string;
  periodStart: string;
  periodEnd: string;
}

function getMedalEmoji(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  return "";
}

const actionBtn =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors text-xs font-mono cursor-pointer";

export function SlideShare({ recapId, data, type, periodStart, periodEnd }: SlideShareProps) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const periodLabel = type === "weekly" ? "Weekly" : "Monthly";
  const dateRange = formatDateRange(periodStart, periodEnd);

  const shareText = `${periodLabel} recap: Rank #${data.rank} | ${formatUsdWhole(data.totalCost)} spent vibecoding`;
  const shareUrl = `https://clawdboard.ai/recap/${recapId}`;

  const handleDownload = async () => {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try {
      window.plausible?.("RecapShare", { props: { method: "download" } });
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(cardRef.current, {
        width: 600,
        height: 400,
        pixelRatio: 2,
        cacheBust: true,
        style: {
          transform: "none",
        },
      });
      const link = document.createElement("a");
      link.download = `clawdboard-recap-${periodStart}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to generate image:", err);
    } finally {
      setDownloading(false);
    }
  };

  const handleTwitter = () => {
    window.plausible?.("RecapShare", { props: { method: "twitter" } });
    window.open(
      buildTwitterIntentUrl(shareText, shareUrl),
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleLinkedIn = () => {
    window.plausible?.("RecapShare", { props: { method: "linkedin" } });
    window.open(
      buildLinkedInShareUrl(shareUrl),
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleCopy = async () => {
    window.plausible?.("RecapShare", { props: { method: "copy" } });
    await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const modelBars = data.modelBreakdown.slice(0, 3);
  const barColors = ["#F9A615", "#3b82f6", "#10b981"];

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="font-mono text-xs text-white/40 uppercase tracking-widest animate-fade-in">
        Share Your Recap
      </p>

      {/* Share card preview */}
      <div className="w-full max-w-[320px] animate-fade-in" style={{ animationDelay: "200ms" }}>
        <div
          ref={cardRef}
          className="relative overflow-hidden rounded-xl border border-white/10"
          style={{
            width: 600,
            height: 400,
            transform: "scale(0.533)",
            transformOrigin: "top left",
            background: "linear-gradient(135deg, #0a0a0c 0%, #1a1a2e 50%, #0a0a0c 100%)",
          }}
        >
          {/* Card content */}
          <div className="absolute inset-0 p-8 flex flex-col justify-between">
            {/* Top row */}
            <div className="flex justify-between items-start">
              <div>
                <span className="font-display text-lg font-bold text-white">
                  <span style={{ color: "#F9A615" }}>$</span> clawdboard
                </span>
                <p className="font-mono text-xs text-white/30 mt-0.5">
                  {periodLabel} Recap &middot; {dateRange}
                </p>
              </div>
              {data.stateTier === "podium" && (
                <span className="text-3xl">{getMedalEmoji(data.rank)}</span>
              )}
            </div>

            {/* Center — rank */}
            <div className="text-center">
              <span className="font-display text-7xl font-black text-white">
                #{data.rank}
              </span>
              <p className="font-mono text-sm text-white/30 mt-1">
                of {data.totalUsers} developers
              </p>
            </div>

            {/* Bottom — stats */}
            <div className="flex justify-between items-end">
              <div className="flex gap-6">
                <div>
                  <p className="font-mono text-xs text-white/30">Spent</p>
                  <p className="font-display text-xl font-bold text-white">
                    {formatUsdWhole(data.totalCost)}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs text-white/30">Tokens</p>
                  <p className="font-display text-xl font-bold text-white">
                    {formatTokensCompact(data.totalTokens)}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs text-white/30">Streak</p>
                  <p className="font-display text-xl font-bold" style={{ color: "#F9A615" }}>
                    {data.currentStreak}d
                  </p>
                </div>
              </div>

              {/* Model bar */}
              {modelBars.length > 0 && (
                <div className="flex flex-col items-end gap-1">
                  {modelBars.map((m, i) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-white/30">
                        {m.name}
                      </span>
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.max(10, m.percentage * 0.8)}px`,
                          backgroundColor: barColors[i],
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Scale container to fit */}
        <div style={{ height: `${400 * 0.533}px`, marginTop: `-${400 * (1 - 0.533)}px` }} />
      </div>

      {/* Action buttons */}
      <div
        className="flex flex-wrap items-center justify-center gap-2 animate-fade-in"
        style={{ animationDelay: "500ms" }}
      >
        <button onClick={handleDownload} disabled={downloading} className={actionBtn}>
          <DownloadIcon />
          {downloading ? "Saving..." : "Download"}
        </button>
        <button onClick={handleTwitter} className={actionBtn}>
          <XIcon />
          Post to X
        </button>
        <button onClick={handleLinkedIn} className={actionBtn}>
          <LinkedInIcon />
          LinkedIn
        </button>
        <button onClick={handleCopy} className={actionBtn}>
          {copied ? (
            <>
              <CheckIcon />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>Copy</>
          )}
        </button>
      </div>

      {/* Past recaps hint */}
      <p
        className="font-mono text-[10px] text-white/20 animate-fade-in"
        style={{ animationDelay: "800ms" }}
      >
        You can revisit past recaps on your profile
      </p>
    </div>
  );
}
