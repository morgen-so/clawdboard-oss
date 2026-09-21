"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DAYS_PER_PASS } from "@/lib/streak";

/**
 * Owner-only: every prop here lands in the page payload, and pass state is
 * private. The profile page doesn't mount this for visitors.
 */
interface StreakPassCelebrationProps {
  username: string;
  /** First day of the live run. Scopes "already seen" to this run. */
  runStart: string | null;
  /** Active days in the current streak. */
  currentStreak: number;
  /** Passes granted over the life of the current run — the trigger. */
  passesEarned: number;
  /** Passes still banked right now. */
  passesLeft: number;
  /** Skip entirely when a takeover owns the screen for good. */
  suppress?: boolean;
  /** Dev preview (?passes=1): open regardless of what's been seen. */
  force?: boolean;
}

const STORAGE_PREFIX = "clawdboard-streak-passes-";

const CONFETTI_COLORS = ["#38bdf8", "#7dd3fc", "#0ea5e9", "#fafafa", "#F9A615"];

/** Any other celebration overlay currently on screen. */
const OTHER_CELEBRATION = '[data-celebration]:not([data-celebration="streak-pass"])';

/**
 * Passes already celebrated in this run. `passesEarned` restarts from zero
 * when a streak breaks, so the count is stored with the run it belongs to —
 * otherwise someone who once reached two passes would never see the first
 * pass of their next run.
 */
function getLastSeen(username: string, runStart: string | null): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + username);
    if (!raw) return 0;
    const [run, count] = raw.split(":");
    if (run !== runStart) return 0;
    const n = parseInt(count, 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

function setLastSeen(
  username: string,
  runStart: string | null,
  count: number
): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + username, `${runStart}:${count}`);
  } catch {
    // localStorage unavailable — the modal just shows again next visit
  }
}

/**
 * Full-screen celebration when the streak banks a new free pass. Fires once
 * per pass earned, tracked in localStorage.
 *
 * A profile visit can unlock badges and bank a pass at the same time, so this
 * queues behind any other celebration already on screen (badge unlock, streak
 * tier-up, the Carcinization takeover) and opens once that one is dismissed.
 */
export function StreakPassCelebration({
  username,
  runStart,
  currentStreak,
  passesEarned,
  passesLeft,
  suppress = false,
  force = false,
}: StreakPassCelebrationProps) {
  const t = useTranslations("profile");
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dismiss = useCallback(() => {
    setArmed(false);
    setVisible(false);
  }, []);

  // 1. Decide whether this visit owes the user a celebration.
  useEffect(() => {
    if (force) {
      setArmed(true);
      return;
    }
    if (suppress || passesEarned === 0) return;
    if (passesEarned <= getLastSeen(username, runStart)) return;
    setArmed(true);
  }, [force, suppress, username, runStart, passesEarned]);

  // 2. Wait for the screen to be free before opening.
  useEffect(() => {
    if (!armed || visible) return;

    const check = () => {
      if (!document.querySelector(OTHER_CELEBRATION)) setVisible(true);
    };
    check();

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [armed, visible]);

  // 3. Only count it as seen once it has actually opened — queued behind
  //    another modal and then navigated away from, it's still owed.
  useEffect(() => {
    if (!visible || force) return;
    if (passesEarned <= getLastSeen(username, runStart)) return;

    setLastSeen(username, runStart, passesEarned);
    window.plausible?.("StreakPassEarned", {
      props: { total: String(passesEarned) },
    });
  }, [visible, force, username, runStart, passesEarned]);

  // 4. Confetti, once it is actually on screen.
  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let burstTimer: ReturnType<typeof setTimeout>;

    (async () => {
      try {
        const confettiModule = await import("canvas-confetti");
        if (cancelled) return;

        const confettiCreate =
          confettiModule.default?.create ?? confettiModule.create;
        const canvas = canvasRef.current;
        if (!confettiCreate || !canvas) return;

        const confetti = confettiCreate(canvas, {
          resize: true,
          useWorker: true,
        });

        confetti({
          particleCount: 50,
          spread: 70,
          origin: { x: 0.5, y: 0.45 },
          colors: CONFETTI_COLORS,
          startVelocity: 28,
          gravity: 0.8,
          ticks: 140,
          scalar: 0.9,
        });

        burstTimer = setTimeout(() => {
          if (cancelled) return;
          confetti({
            particleCount: 25,
            spread: 45,
            origin: { x: 0.5, y: 0.45 },
            colors: CONFETTI_COLORS,
            startVelocity: 18,
            gravity: 0.6,
            ticks: 90,
            scalar: 0.7,
          });
        }, 280);
      } catch {
        // Silently fail — the modal still stands on its own
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(burstTimer);
    };
  }, [visible]);

  // Esc closes, matching the other profile takeovers.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      data-celebration="streak-pass"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ width: "100%", height: "100%" }}
      />

      <div
        className="relative z-10 mx-4 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-sky-500/40 bg-surface p-8 text-center shadow-[0_0_40px_rgba(14,165,233,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-5xl" aria-hidden="true">
          &#127903;
        </span>
        <h2 className="font-display text-2xl font-bold uppercase tracking-wider text-sky-400">
          {t("passEarnedTitle", { count: passesEarned })}
        </h2>
        <p className="font-mono text-lg text-foreground">
          {t("passEarnedBody", { days: DAYS_PER_PASS })}
        </p>
        <p className="text-sm text-muted">
          {t("passEarnedStreak", { days: currentStreak, left: passesLeft })}
        </p>

        <button
          onClick={dismiss}
          className="mt-1 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer"
        >
          {t("passEarnedDismiss")}
        </button>
      </div>
    </div>
  );
}
