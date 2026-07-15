"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { StreakAura } from "@/components/ui/StreakAura";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";
import { buildTwitterIntentUrl, buildLinkedInShareUrl } from "@/lib/share";
import { formatTokensCompact, formatUsd } from "@/lib/format";
import { TRANSCENDENT_MIN_DAYS } from "@/lib/streak-tiers";
import {
  CheckIcon,
  LinkIcon,
  LinkedInIcon,
  XIcon,
} from "@/components/icons/CommonIcons";

// ─── The Carcinization Event ─────────────────────────────────────────────────
// Fires ONCE, full-screen, the first time a user views their own profile with
// a current streak >= 200 days. Five acts: the site "crashes" (glitch → kernel
// panic), reboots through a CLAWD-BIOS POST that weaves the user's real stats
// into the boot log, and then CLAWD PRIME — the crab deity — materializes to
// explain that after 200 unbroken days, carcinisation has run in reverse:
// the crab has evolved into the user. Coronation with the tier-7 aura follows.

interface CarcinizationStats {
  totalTokens: number;
  /** Stringified numeric, as stored in summaries (fed to formatUsd). */
  totalCost: string;
  rank: number;
  totalUsers: number;
}

interface CarcinizationEventProps {
  username: string;
  image: string | null;
  currentStreak: number;
  stats: CarcinizationStats;
  /** Dev-only preview (?carcinize=1): always plays, never persists. */
  force?: boolean;
}

// ─── localStorage gate ──────────────────────────────────────────────────────

function hasSeenCarcinization(username: string): boolean {
  try {
    return localStorage.getItem(`clawdboard-carcinized-${username}`) === "1";
  } catch {
    return true; // storage unavailable — err on the side of not re-showing
  }
}

function markCarcinizationSeen(username: string): void {
  try {
    localStorage.setItem(`clawdboard-carcinized-${username}`, "1");
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

// ─── Fixed content ──────────────────────────────────────────────────────────

// Glitch frames for Act 1 — numeric literals, deliberately untranslated.
const SCRAMBLE_FRAMES = ["199", "200", "0xC8", "NaN", "∞"];

// Auto-advance timings per act; the final act persists until dismissed.
const ACT_DURATIONS: (number | null)[] = [2500, 3500, 7000, 7000, null];
const FINAL_ACT = ACT_DURATIONS.length - 1;

// CLAWD PRIME, THE FIRST MOLT. Do not question the geometry.
const CLAWD_PRIME = [
  "  ████████                          ████████",
  "████    ████                      ████    ████",
  "████                                      ████",
  "████    ████                      ████    ████",
  "  ████████        ██      ██        ████████",
  "    ████          ██      ██          ████",
  "      ████    ██████████████████    ████",
  "          ██████████████████████████",
  "          ██████    ██████    ██████",
  "          ██████████████████████████",
  "            ████  ████  ████  ████",
  "      ████    ████          ████    ████",
  "    ████    ████              ████    ████",
  "  ████    ████                  ████    ████",
];

const CONFETTI_GOLD = ["#F9A615", "#FBC15B", "#facc15", "#fafafa"];

const shareBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:border-border-bright text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer";

// ─── Component ──────────────────────────────────────────────────────────────

export function CarcinizationEvent({
  username,
  image,
  currentStreak,
  stats,
  force = false,
}: CarcinizationEventProps) {
  const t = useTranslations("bicentennial");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const [show, setShow] = useState(false);
  const [act, setAct] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { copied, copy: copyProfileUrl } = useCopyToClipboard();

  // Starfield for Acts 4-5 — client-only render, so Math.random is hydration-safe.
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        size: Math.random() < 0.3 ? 2 : 1,
        delay: `${(Math.random() * 3).toFixed(2)}s`,
      })),
    []
  );

  // ── Fire-once gate ──
  useEffect(() => {
    if (!force) {
      if (currentStreak < TRANSCENDENT_MIN_DAYS) return;
      if (hasSeenCarcinization(username)) return;
      // Persist at fire time (same tradeoff as StreakCelebration): a reload
      // mid-cinematic forfeits the replay rather than risking re-annoyance.
      markCarcinizationSeen(username);
    }
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    setReducedMotion(prefersReduced);
    // Reduced motion: skip the theatrics, go straight to a static coronation.
    if (prefersReduced) setAct(FINAL_ACT);
    setShow(true);
  }, [force, username, currentStreak]);

  // ── Act auto-advance ──
  useEffect(() => {
    if (!show) return;
    const duration = ACT_DURATIONS[act];
    if (duration == null) return;
    const timer = setTimeout(
      () => setAct((a) => Math.min(a + 1, FINAL_ACT)),
      duration
    );
    return () => clearTimeout(timer);
  }, [show, act]);

  // ── Crab confetti on coronation ──
  useEffect(() => {
    if (!show || act !== FINAL_ACT || reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let burstTimer: ReturnType<typeof setTimeout>;

    (async () => {
      try {
        const confettiModule = await import("canvas-confetti");
        if (cancelled) return;

        const confettiApi = confettiModule.default ?? confettiModule;
        const confettiCreate = confettiApi.create;
        if (!confettiCreate) return;

        // Text shapes don't render reliably inside OffscreenCanvas workers,
        // so unlike the other celebration modals this instance keeps the
        // worker OFF. Do not "fix" this back to useWorker: true.
        const confetti = confettiCreate(canvas, {
          resize: true,
          useWorker: false,
        });

        let crabShapes: ReturnType<typeof confettiApi.shapeFromText>[] | null =
          null;
        try {
          if (typeof confettiApi.shapeFromText === "function") {
            crabShapes = [confettiApi.shapeFromText({ text: "🦀", scalar: 3 })];
          }
        } catch {
          crabShapes = null; // emoji rasterization failed — fall back to gold
        }

        // First burst: raining crabs (or gold if the emoji shape failed)
        confetti({
          particleCount: 50,
          spread: 120,
          origin: { x: 0.5, y: 0.4 },
          startVelocity: 35,
          gravity: 0.9,
          ticks: 200,
          ...(crabShapes
            ? { shapes: crabShapes, scalar: 3 }
            : { colors: CONFETTI_GOLD, scalar: 1 }),
        });

        // Second burst: gold shimmer follow-up
        burstTimer = setTimeout(() => {
          if (cancelled) return;
          confetti({
            particleCount: 90,
            spread: 140,
            origin: { x: 0.5, y: 0.35 },
            colors: CONFETTI_GOLD,
            startVelocity: 30,
            gravity: 0.8,
            ticks: 150,
            scalar: 0.9,
          });
        }, 350);
      } catch {
        // Silently fail
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(burstTimer);
    };
  }, [show, act, reducedMotion]);

  // ── Input handling ──
  const dismiss = useCallback(() => setShow(false), []);
  const skipToCoronation = useCallback(() => setAct(FINAL_ACT), []);

  const handleEscape = useCallback(() => {
    if (act < FINAL_ACT) setAct(FINAL_ACT);
    else dismiss();
  }, [act, dismiss]);

  useModalDismiss(show, handleEscape);

  const handleAdvanceClick = useCallback(() => {
    if (act < FINAL_ACT) setAct((a) => Math.min(a + 1, FINAL_ACT));
  }, [act]);

  // ── Share handlers ──
  const profileUrl = `https://clawdboard.ai/user/${username}`;
  const shareText = t("shareText", { streak: currentStreak });

  const handleTwitter = useCallback(() => {
    window.plausible?.("CarcinizationShare", { props: { method: "twitter" } });
    window.open(
      buildTwitterIntentUrl(shareText, profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  }, [shareText, profileUrl]);

  const handleLinkedIn = useCallback(() => {
    window.plausible?.("CarcinizationShare", { props: { method: "linkedin" } });
    window.open(
      buildLinkedInShareUrl(profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  }, [profileUrl]);

  const handleCopyLink = useCallback(async () => {
    window.plausible?.("CarcinizationShare", { props: { method: "copy_link" } });
    await copyProfileUrl(profileUrl);
  }, [profileUrl, copyProfileUrl]);

  if (!show) return null;

  const bootLines: { text: string; className: string }[] = [
    {
      text: t("boot.memory", {
        tokens: formatTokensCompact(stats.totalTokens, locale),
      }),
      className: "text-foreground/80",
    },
    {
      text: t("boot.treasury", { cost: formatUsd(stats.totalCost, locale) }),
      className: "text-foreground/80",
    },
    { text: t("boot.social"), className: "text-muted" },
    {
      text: t("boot.leaderboard", {
        rank: stats.rank,
        totalUsers: stats.totalUsers,
      }),
      className: "text-foreground/80",
    },
    { text: t("boot.board"), className: "text-foreground/80" },
    { text: t("boot.holiday"), className: "text-foreground/80" },
    { text: t("boot.protocol"), className: "text-accent font-bold" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={t("a11yLabel")}
      onClick={handleAdvanceClick}
    >
      {/* Starfield backdrop (crab god + coronation) */}
      {act >= 3 && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {stars.map((star) => (
            <span
              key={star.id}
              className="carc-star absolute rounded-full bg-white"
              style={
                {
                  left: star.left,
                  top: star.top,
                  width: star.size,
                  height: star.size,
                  "--twinkle-delay": star.delay,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* ACT 1 — GLITCH: the streak counter breaks arithmetic */}
      {act === 0 && (
        <div
          className="carc-glitch relative font-display text-8xl font-bold text-foreground sm:text-9xl"
          aria-hidden="true"
        >
          {SCRAMBLE_FRAMES.slice(0, -1).map((frame, i) => (
            <span
              key={frame}
              className="carc-frame absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ "--i": i } as React.CSSProperties}
            >
              {frame}
            </span>
          ))}
          <span
            className="carc-frame-last"
            style={
              { "--i": SCRAMBLE_FRAMES.length - 1 } as React.CSSProperties
            }
          >
            {SCRAMBLE_FRAMES[SCRAMBLE_FRAMES.length - 1]}
          </span>
        </div>
      )}

      {/* ACT 2 — KERNEL PANIC */}
      {act === 1 && (
        <div
          className="w-full max-w-2xl px-6 font-mono text-sm"
          style={{ "--line-gap": "0.45s" } as React.CSSProperties}
        >
          <p
            className="carc-bootline font-bold text-red-300"
            style={{ "--line-index": 0 } as React.CSSProperties}
          >
            *** {t("panic.title")} ***
          </p>
          <p
            className="carc-bootline mt-3 text-red-400"
            style={{ "--line-index": 1 } as React.CSSProperties}
          >
            {t("panic.reason")}
          </p>
          <div className="mt-3 space-y-1 pl-6 text-red-400/80">
            {(["trace1", "trace2", "trace3"] as const).map((key, i) => (
              <p
                key={key}
                className="carc-bootline"
                style={{ "--line-index": i + 2 } as React.CSSProperties}
              >
                {t(`panic.${key}`)}
              </p>
            ))}
          </div>
          <span className="animate-blink mt-3 inline-block text-red-400">
            ▮
          </span>
        </div>
      )}

      {/* ACT 3 — CLAWD-BIOS BOOT LOG */}
      {act === 2 && (
        <div className="w-full max-w-3xl px-6 font-mono text-xs sm:text-sm">
          <p
            className="carc-bootline mb-4 font-bold text-accent-bright"
            style={{ "--line-index": 0 } as React.CSSProperties}
          >
            {t("boot.header")}
          </p>
          <div className="space-y-2">
            {bootLines.map((line, i) => (
              <p
                key={i}
                className={`carc-bootline ${line.className}`}
                style={{ "--line-index": i + 1 } as React.CSSProperties}
              >
                {line.text}
              </p>
            ))}
          </div>
          <span className="animate-blink mt-3 inline-block text-foreground/60">
            ▮
          </span>
        </div>
      )}

      {/* ACT 4 — CLAWD PRIME MATERIALIZES */}
      {act === 3 && (
        <div className="relative flex w-full flex-col items-center gap-6 px-4">
          <pre
            className="font-mono text-[8px] leading-none text-accent sm:text-xs md:text-sm"
            aria-hidden="true"
          >
            {CLAWD_PRIME.map((line, i) => (
              <span
                key={i}
                className="carc-crabline block"
                style={{ "--line-index": i } as React.CSSProperties}
              >
                {line}
              </span>
            ))}
          </pre>
          <div
            className="flex max-w-xl flex-col gap-3 text-center font-mono text-[11px] text-foreground/90 sm:text-sm"
            style={{ "--line-gap": "1.3s" } as React.CSSProperties}
          >
            {(["line1", "line2", "line3"] as const).map((key, i) => (
              <p
                key={key}
                className="carc-bootline"
                style={{ "--line-index": i + 1 } as React.CSSProperties}
              >
                {t(`crab.${key}`, { streak: currentStreak })}
              </p>
            ))}
            <p
              className="carc-bootline font-bold text-accent-bright"
              style={{ "--line-index": 4 } as React.CSSProperties}
            >
              {t("crab.line4", { username })}
            </p>
          </div>
        </div>
      )}

      {/* ACT 5 — CORONATION (persists until dismissed) */}
      {act === FINAL_ACT && (
        <div className="animate-fade-in relative z-10 flex max-w-lg flex-col items-center gap-5 px-6 text-center">
          <StreakAura streak={currentStreak} size="lg">
            {image ? (
              <Image
                src={image}
                alt={username}
                width={96}
                height={96}
                className="h-24 w-24 rounded-full"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-surface-hover text-3xl font-bold text-muted">
                {username.slice(0, 2).toUpperCase()}
              </div>
            )}
          </StreakAura>

          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
            {t("coronation.molt")}
          </p>
          <h2 className="font-display text-4xl font-bold uppercase tracking-wider text-accent-bright drop-shadow-[0_0_12px_rgba(249,166,21,0.6)] sm:text-6xl">
            {t("coronation.title")}
          </h2>
          <p className="font-mono text-lg text-foreground">
            {t("coronation.subtitle", { streak: currentStreak })}
          </p>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <button onClick={handleTwitter} className={shareBtn}>
              <XIcon />
              {tp("shareOnTwitter")}
            </button>
            <button onClick={handleLinkedIn} className={shareBtn}>
              <LinkedInIcon />
              {tp("shareOnLinkedIn")}
            </button>
            <button onClick={handleCopyLink} className={shareBtn}>
              {copied ? (
                <>
                  <CheckIcon />
                  <span className="text-success">{tp("copied")}</span>
                </>
              ) : (
                <>
                  <LinkIcon />
                  {tp("copyLink")}
                </>
              )}
            </button>
          </div>

          <button
            onClick={dismiss}
            className="mt-2 rounded-lg border border-border bg-background px-4 py-2 font-mono text-sm text-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            {t("coronation.dismiss")}
          </button>
        </div>
      )}

      {/* Confetti canvas — above everything, never intercepts clicks */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-20"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Always-visible skip (mobile has no Esc key) */}
      {act < FINAL_ACT && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            skipToCoronation();
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-white/30 transition-colors hover:text-white/60"
        >
          {t("skipHint")}
        </button>
      )}
    </div>,
    document.body
  );
}
