"use client";

import { useEffect, useState, useRef } from "react";
import type { EarnedBadge } from "@/lib/badges";
import type { KitchenRank, XpProgress } from "@/lib/kitchen-rank";
import { KitchenRankIcon } from "@/components/icons/KitchenRankIcons";
import { getKitchenRank } from "@/lib/kitchen-rank";

// ─── Props ───────────────────────────────────────────────────────────────────

interface BadgeUnlockModalProps {
  username: string;
  badges: EarnedBadge[];
  totalXp: number;
  xpProgress: XpProgress;
  /** When true, silently mark all earned badges as seen without showing the modal.
   *  Used on first visit so retroactive badges don't trigger a celebration. */
  suppressModal?: boolean;
  /** Badge ids whose celebration is owned by another surface (e.g. the
   *  Carcinization takeover for streak-200). Marked as seen, never shown here. */
  suppressBadgeIds?: string[];
}

// ─── localStorage helpers ────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "clawdboard-seen-badges-";

function getSeenBadges(username: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${username}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function markBadgesSeen(username: string, ids: string[]): void {
  try {
    const existing = getSeenBadges(username);
    for (const id of ids) existing.add(id);
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${username}`,
      JSON.stringify([...existing])
    );
  } catch {
    // silently fail
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BadgeUnlockModal({
  username,
  badges,
  totalXp,
  xpProgress,
  suppressModal = false,
  suppressBadgeIds,
}: BadgeUnlockModalProps) {
  const [newBadges, setNewBadges] = useState<EarnedBadge[]>([]);
  const [animatedXp, setAnimatedXp] = useState(totalXp);
  const [showRankUp, setShowRankUp] = useState(false);
  const [rankUpRank, setRankUpRank] = useState<KitchenRank | null>(null);
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const earnedBadges = badges.filter((b) => b.earned);
    const earnedIds = earnedBadges.map((b) => b.definition.id);

    if (suppressModal) {
      // First visit — silently mark all earned badges as seen
      markBadgesSeen(username, earnedIds);
      return;
    }

    // Mark suppressed-but-earned badges as seen so they never pop later
    const suppressed = new Set(suppressBadgeIds ?? []);
    const suppressedEarned = earnedIds.filter((id) => suppressed.has(id));
    if (suppressedEarned.length > 0) {
      markBadgesSeen(username, suppressedEarned);
    }

    const seen = getSeenBadges(username);
    const newlyEarned = earnedBadges.filter(
      (b) => !seen.has(b.definition.id)
    );

    if (newlyEarned.length === 0) {
      markBadgesSeen(username, earnedIds);
      return;
    }

    // Calculate previous XP (before new badges)
    const newXpGain = newlyEarned.reduce(
      (sum, b) => sum + b.definition.xp,
      0
    );
    const oldXp = totalXp - newXpGain;

    // Check if rank changed
    const oldRank = getKitchenRank(oldXp);

    setNewBadges(newlyEarned);
    setAnimatedXp(oldXp);
    setOpen(true);

    // Animate XP after a brief delay
    const xpTimer = setTimeout(() => {
      setAnimatedXp(totalXp);
    }, 300);

    // Rank-up animation if crossed threshold
    if (xpProgress.current.tier > oldRank.tier) {
      const rankTimer = setTimeout(() => {
        setShowRankUp(true);
        setRankUpRank(xpProgress.current);
        // Fire confetti for rank-up
        fireConfetti();
      }, 1200);
      return () => {
        clearTimeout(xpTimer);
        clearTimeout(rankTimer);
      };
    } else if (newlyEarned.some((b) => b.definition.celebrationTier)) {
      // Fire confetti for celebration-tier badges
      const confettiTimer = setTimeout(() => fireConfetti(), 800);
      return () => {
        clearTimeout(xpTimer);
        clearTimeout(confettiTimer);
      };
    }

    return () => clearTimeout(xpTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fireConfetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        const confettiModule = await import("canvas-confetti");
        const confettiCreate =
          confettiModule.default?.create ?? confettiModule.create;
        if (!confettiCreate) return;

        const confetti = confettiCreate(canvas, {
          resize: true,
          useWorker: true,
        });

        confetti({
          particleCount: 80,
          spread: 90,
          origin: { x: 0.5, y: 0.45 },
          colors: ["#F9A615", "#FBC15B", "#fafafa", "#34d399"],
          startVelocity: 30,
          gravity: 0.8,
          ticks: 150,
          scalar: 0.9,
        });
      } catch {
        // silently fail
      }
    })();
  }

  function handleDismiss() {
    // Mark all earned badges as seen on dismiss
    markBadgesSeen(
      username,
      badges.filter((b) => b.earned).map((b) => b.definition.id)
    );
    setOpen(false);
  }

  if (!open || newBadges.length === 0) return null;

  // Calculate progress bar percent for animation
  const progressForBar = xpProgress.next
    ? Math.min(
        100,
        Math.round(
          ((animatedXp - xpProgress.current.minXp) /
            (xpProgress.next.minXp - xpProgress.current.minXp)) *
            100
        )
      )
    : 100;

  // If the XP crosses into a new rank, we want the bar at 100% briefly
  const displayPercent = showRankUp ? 100 : Math.max(0, progressForBar);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
      />

      {/* Confetti canvas */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-[51]"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Modal */}
      <div className="relative z-[52] w-full max-w-sm rounded-lg border border-accent/30 bg-surface p-6 shadow-xl animate-[fadeInUp_0.3s_ease-out]">
        <h3 className="font-display text-lg font-bold text-foreground mb-4 text-center">
          {newBadges.length === 1 ? "Badge Unlocked!" : `${newBadges.length} Badges Unlocked!`}
        </h3>

        {/* New badges list */}
        <div className="space-y-2 mb-5 max-h-60 overflow-y-auto">
          {newBadges.map((badge) => (
            <div
              key={badge.definition.id}
              className="flex items-center justify-between rounded-md border border-accent/20 bg-accent/5 px-3 py-2"
            >
              <span className="font-mono text-xs text-foreground">
                {badge.definition.label}
              </span>
              <span className="font-mono text-xs text-accent font-bold">
                +{badge.definition.xp} XP
              </span>
            </div>
          ))}
        </div>

        {/* XP progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className={`font-mono text-xs font-bold ${xpProgress.current.color}`}>
              {showRankUp && rankUpRank ? rankUpRank.title : xpProgress.current.title}
            </span>
            <span className="font-mono text-[10px] text-dim">
              {animatedXp} XP
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-background overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-1000 ease-out"
              style={{ width: `${displayPercent}%` }}
            />
          </div>
        </div>

        {/* Rank-up animation */}
        {showRankUp && rankUpRank && (
          <div className="flex items-center justify-center gap-2 my-3 animate-[fadeInUp_0.4s_ease-out]">
            <span className={`${rankUpRank.color} animate-pulse`}>
              <KitchenRankIcon tier={rankUpRank.tier} className="h-8 w-8" />
            </span>
            <span className={`font-display text-sm font-bold ${rankUpRank.color}`}>
              Ranked up to {rankUpRank.title}!
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end mt-4 pt-3 border-t border-border">
          <button
            onClick={handleDismiss}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
