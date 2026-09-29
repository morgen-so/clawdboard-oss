"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { StreakAura } from "@/components/ui/StreakAura";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";
import { buildTwitterIntentUrl, buildLinkedInShareUrl } from "@/lib/share";
import { formatTokensCompact, formatUsdWhole } from "@/lib/format";
import { TRANSCENDENT_MIN_DAYS, getStreakTier } from "@/lib/streak-tiers";
import type { CarcinizationRun } from "@/lib/carcinization-run";
import {
  CheckIcon,
  LinkIcon,
  LinkedInIcon,
  XIcon,
} from "@/components/icons/CommonIcons";
import {
  CarcStage,
  replayTimeline,
  type Beat,
} from "./carcinization/stage";
import { CarcSound } from "./carcinization/sound";
import { PixelCrab } from "./carcinization/PixelCrab";

// ─── The Carcinization Event ─────────────────────────────────────────────────
// Fires ONCE, full-screen, the first time a user views their own profile with
// a current streak >= 200 days. Eight beats:
//
//   anomaly  the live profile glitches, then collapses like a CRT switching off
//   panic    kernel panic, ending on "press any key to reboot" (the keypress is
//            the user gesture that lets the browser play sound)
//   boot     CLAWD-BIOS POST, with the user's real stats in the log
//   replay   every day of the run lights up in order, accelerating through the
//            streak tiers until the grid implodes into a singularity
//   bang     the singularity detonates; hyperspace
//   summon   the same particles reassemble as CLAWD PRIME, who explains that
//            carcinisation has run in reverse: the crab has evolved into you
//   ascend   the deity pours itself into the user's avatar
//   crown    coronation: tier-7 aura, fireworks, a crab rave. Stays until dismissed.
//
// Canvas work lives in ./carcinization/stage, sound in ./carcinization/sound.

interface CarcinizationStats {
  /** Tokens across the run. */
  totalTokens: number;
  /** Spend across the run, in USD. */
  totalCost: number;
  rank: number;
  totalUsers: number;
}

interface CarcinizationEventProps {
  username: string;
  image: string | null;
  currentStreak: number;
  /** The live run, a day at a time. Null only in a dev preview without one. */
  run: CarcinizationRun | null;
  stats: CarcinizationStats;
  /** Dev-only preview (?carcinize=1): always plays, never persists. */
  force?: boolean;
  /** Dev-only: start the preview at a given beat (?carcinize=summon). */
  startAt?: string;
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

// ─── Timing ─────────────────────────────────────────────────────────────────

const BEATS: Beat[] = [
  "anomaly",
  "panic",
  "boot",
  "replay",
  "bang",
  "summon",
  "ascend",
  "crown",
];

const ANOMALY_MS = 2800;
/** When the glitching page gives way to the CRT collapse. */
const CRT_AT_MS = 1600;
/** No keypress? Reboot anyway, silently. */
const PANIC_AUTO_MS = 8000;
const PANIC_LINE_GAP = 0.38;
const BOOT_LINE_BASE = 0.55;
const BOOT_LINE_GAP = 0.5;
const BOOT_MS = 5700;
const BANG_MS = 2800;
const ASCEND_MS = 1750;
/** Crown: when the title lands (matches carc-slam in globals.css). */
const TITLE_LANDS_MS = 900;

// Glitch frames for the anomaly — numeric literals, deliberately untranslated.
const SCRAMBLE_FRAMES = ["199", "200", "0xC8", "NaN", "∞"];

const BOOT_KEYS = [
  "memory",
  "treasury",
  "social",
  "leaderboard",
  "board",
  "holiday",
  "protocol",
] as const;

const BOOT_STATUS_CLASS: Record<(typeof BOOT_KEYS)[number], string> = {
  memory: "text-success",
  treasury: "text-success",
  social: "text-red-400",
  leaderboard: "text-accent-bright",
  board: "text-success",
  holiday: "text-accent",
  protocol: "carc-armed text-red-400 font-bold",
};

const CONFETTI_GOLD = ["#F9A615", "#FBC15B", "#facc15", "#fafafa"];
const RAVE_DANCERS = 9;
const MS_PER_DAY = 86_400_000;

const shareBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-black/40 backdrop-blur hover:border-border-bright text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer";

/**
 * setTimeout that stops counting while the tab is hidden, so switching away
 * mid-show pauses the story instead of letting it run on without you (the
 * canvas stops drawing when hidden anyway). Returns a cancel function.
 */
function pausableTimeout(fn: () => void, ms: number): () => void {
  let remaining = ms;
  let startedAt = 0;
  let id: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    startedAt = performance.now();
    id = setTimeout(() => {
      cancel();
      fn();
    }, remaining);
  };
  const onVisibility = () => {
    if (document.hidden && id !== null) {
      clearTimeout(id);
      id = null;
      remaining -= performance.now() - startedAt;
    } else if (!document.hidden && id === null) {
      run();
    }
  };
  const cancel = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (id !== null) clearTimeout(id);
    id = null;
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) run();
  return cancel;
}

/** "LABEL .......... STATUS" → both halves, so the status can take a colour. */
function splitStatus(text: string): [string, string | null] {
  const m = text.match(/^(.*?\S)\s+\.{3,}\s+(.*)$/);
  return m ? [m[1], m[2]] : [text, null];
}

/** A plausible run for the dev preview when the viewer doesn't have one. */
function previewRun(): { start: string; days: number[] } {
  const days = Array.from({ length: TRANSCENDENT_MIN_DAYS + 5 }, (_, i) =>
    Math.round((0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31))) * 100) / 100
  );
  const start = new Date(Date.now() - (days.length - 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  return { start, days };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CarcinizationEvent({
  username,
  image,
  currentStreak,
  run,
  stats,
  force = false,
  startAt,
}: CarcinizationEventProps) {
  const t = useTranslations("bicentennial");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const [show, setShow] = useState(false);
  const [beat, setBeat] = useState<Beat>("anomaly");
  const [line, setLine] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** Bumped by "replay": each take gets a fresh stage. */
  const [take, setTake] = useState(0);
  const { copied, copy: copyProfileUrl } = useCopyToClipboard();

  const rootRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<CarcStage | null>(null);
  const soundRef = useRef<CarcSound | null>(null);
  const lastTierRef = useRef(0);

  // The run to replay. Client-only render, so the preview's clock is safe.
  const replay = useMemo(() => run ?? previewRun(), [run]);
  const timeline = useMemo(
    () => replayTimeline(replay.days.length),
    [replay.days.length]
  );
  const startMs = Date.parse(`${replay.start}T00:00:00Z`);
  const startWeekday = (new Date(startMs).getUTCDay() + 6) % 7;

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    [locale]
  );

  const crabLines = useMemo(
    () => [
      t("crab.line1"),
      t("crab.line2"),
      t("crab.line3", { streak: currentStreak }),
      t("crab.line4", { username }),
    ],
    [t, currentStreak, username]
  );
  // Long enough to read, then a beat longer on the final pronouncement.
  const lineMs = useMemo(
    () =>
      crabLines.map(
        (l, i) =>
          Math.min(3800, Math.max(2400, 1100 + l.length * 26)) +
          (i === crabLines.length - 1 ? 700 : 0)
      ),
    [crabLines]
  );

  // ── Fire-once gate ──
  useEffect(() => {
    if (!force) {
      if (currentStreak < TRANSCENDENT_MIN_DAYS) return;
      if (hasSeenCarcinization(username)) return;
    }
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    setReducedMotion(prefersReduced);
    // Reduced motion: skip the theatrics, go straight to a static coronation.
    if (prefersReduced) setBeat("crown");
    else if (startAt && (BEATS as string[]).includes(startAt)) {
      setBeat(startAt as Beat);
    }
    const start = () => {
      // Persist at fire time (same tradeoff as StreakCelebration): a reload
      // mid-cinematic forfeits the replay rather than risking re-annoyance.
      if (!force) markCarcinizationSeen(username);
      setShow(true);
    };
    // Opened in a background tab? Hold the curtain until someone's watching,
    // or the glitch plays out to nobody (and the one showing is spent).
    if (!document.hidden) {
      start();
      return;
    }
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVisible);
      start();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [force, username, currentStreak, startAt]);

  // ── Replay HUD: written straight to the DOM, up to once a frame ──
  const onDay = useCallback(
    (activeDays: number, dayIndex: number) => {
      const counter = counterRef.current;
      if (counter) counter.textContent = String(activeDays).padStart(3, "0");
      if (dateRef.current) {
        dateRef.current.textContent = dayFormat.format(
          new Date(startMs + dayIndex * MS_PER_DAY)
        );
      }
      const tier = getStreakTier(activeDays);
      if (tier.tier === lastTierRef.current) return;
      lastTierRef.current = tier.tier;
      const label = tierRef.current;
      if (!label || !counter) return;
      // Tier 7 stays a secret until the coronation.
      const secret = tier.tier >= 7;
      label.textContent = secret ? "▓▓▓▓▓▓▓▓▓▓" : tier.name.toUpperCase();
      label.dataset.redacted = String(secret);
      counter.style.setProperty(
        "--tier-color",
        secret ? "#fafafa" : tier.staticRingColor
      );
      label.style.color = secret ? "#fafafa" : tier.staticRingColor;
      label.animate?.(
        [
          { transform: "scale(1.9)", opacity: 0, filter: "blur(6px)" },
          { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
        ],
        { duration: 420, easing: "cubic-bezier(.2,1.4,.4,1)" }
      );
      counter.animate?.(
        [{ transform: "scale(1.14)" }, { transform: "scale(1)" }],
        { duration: 320, easing: "ease-out" }
      );
    },
    [dayFormat, startMs]
  );
  const onDayRef = useRef(onDay);
  onDayRef.current = onDay;

  // ── Sound lives for the whole event, so a replay keeps it unlocked ──
  useEffect(() => {
    if (!show || reducedMotion) return;
    const sound = new CarcSound();
    soundRef.current = sound;
    return () => {
      sound.dispose();
      soundRef.current = null;
    };
  }, [show, reducedMotion]);

  // ── A fresh stage per take ──
  useEffect(() => {
    if (!show || reducedMotion) return;
    const canvas = stageCanvasRef.current;
    const sound = soundRef.current;
    if (!canvas || !sound) return;
    const stage = new CarcStage(canvas, {
      days: replay.days,
      startWeekday,
      sound,
      shakeEl: shakeRef.current,
      onDay: (a, i) => onDayRef.current(a, i),
    });
    stageRef.current = stage;
    stage.start();
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
    // The run is fixed for the life of the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, reducedMotion, take]);

  // ── Anomaly: glitch the live page, then switch it off like a CRT ──
  useEffect(() => {
    if (!show || beat !== "anomaly") return;
    const html = document.documentElement;
    const portal = rootRef.current;
    // Each top-level element collapses toward the middle of the viewport, which
    // sits at a different offset inside each of them.
    const mid = window.scrollY + window.innerHeight / 2;
    const pageEls = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== portal
    );
    for (const el of pageEls) {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty("--carc-oy", `${mid - top}px`);
    }
    html.dataset.carc = "glitch";
    const cancelCrt = pausableTimeout(() => {
      html.dataset.carc = "crt";
    }, CRT_AT_MS);
    return () => {
      cancelCrt();
      delete html.dataset.carc;
      for (const el of pageEls) el.style.removeProperty("--carc-oy");
    };
  }, [show, beat]);

  // ── Coronation anchor: where the avatar sits. Measured before the beat
  // effect below hands it to the stage. ──
  useEffect(() => {
    if (!show || (beat !== "ascend" && beat !== "crown")) return;
    const measure = () => {
      const r = avatarRef.current?.getBoundingClientRect();
      if (r) stageRef.current?.setAnchor(r.left + r.width / 2, r.top + r.height / 2);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [show, beat]);

  // ── Beat clock ──
  useEffect(() => {
    if (!show) return;
    const stage = stageRef.current;
    const sound = soundRef.current;
    stage?.setBeat(beat);
    const timers: (() => void)[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(pausableTimeout(fn, ms));
    let stopDrone: ((fade?: number) => void) | null = null;

    switch (beat) {
      case "anomaly":
        at(ANOMALY_MS, () => setBeat("panic"));
        break;
      case "panic":
        at(PANIC_AUTO_MS, () => setBeat("boot"));
        break;
      case "boot":
        sound?.powerOn();
        at(260, () => sound?.beep());
        BOOT_KEYS.forEach((key, i) => {
          const ms = (BOOT_LINE_BASE + (i + 1) * BOOT_LINE_GAP) * 1000 + 120;
          at(ms, () => (key === "protocol" ? sound?.alarm() : sound?.click()));
        });
        at(BOOT_MS, () => setBeat("replay"));
        break;
      case "replay":
        lastTierRef.current = 0;
        at(timeline.total * 1000, () => setBeat("bang"));
        break;
      case "bang":
        at(BANG_MS, () => setBeat("summon"));
        break;
      case "summon":
        stopDrone = sound?.drone() ?? null;
        break;
      case "ascend":
        at(ASCEND_MS, () => setBeat("crown"));
        break;
      case "crown":
        at(TITLE_LANDS_MS, () => {
          stage?.shake(9);
          sound?.thud();
        });
        break;
    }
    return () => {
      timers.forEach((cancel) => cancel());
      stopDrone?.(1.6);
    };
  }, [show, beat, timeline.total]);

  // ── CLAWD PRIME's lines ──
  useEffect(() => {
    if (!show || beat !== "summon") return;
    if (line >= 0) {
      stageRef.current?.pulse();
      soundRef.current?.speak();
    }
    const last = crabLines.length - 1;
    return pausableTimeout(
      () => (line < last ? setLine(line + 1) : setBeat("ascend")),
      line < 0 ? 1100 : lineMs[line]
    );
  }, [show, beat, line, crabLines.length, lineMs]);

  // ── Crab confetti on coronation ──
  useEffect(() => {
    if (!show || beat !== "crown" || reducedMotion) return;
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

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

        // Raining crabs from above the avatar (or gold if the shape failed)
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            confetti({
              particleCount: 60,
              spread: 140,
              origin: { x: 0.5, y: 0.3 },
              startVelocity: 38,
              gravity: 0.9,
              ticks: 260,
              ...(crabShapes
                ? { shapes: crabShapes, scalar: 3 }
                : { colors: CONFETTI_GOLD, scalar: 1 }),
            });
          }, TITLE_LANDS_MS)
        );

        // Gold cannons from both bottom corners
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            for (const [x, angle] of [
              [0, 60],
              [1, 120],
            ] as const) {
              confetti({
                particleCount: 80,
                angle,
                spread: 55,
                origin: { x, y: 1 },
                colors: CONFETTI_GOLD,
                startVelocity: 70,
                gravity: 1,
                ticks: 240,
                scalar: 0.9,
              });
            }
          }, TITLE_LANDS_MS + 250)
        );
      } catch {
        // Silently fail
      }
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [show, beat, reducedMotion]);

  // ── Input ──
  const dismiss = useCallback(() => setShow(false), []);

  /** Run it all again, from the glitch. */
  const replayShow = useCallback(() => {
    window.plausible?.("CarcinizationReplay");
    soundRef.current?.unlock();
    setLine(-1);
    setTake((n) => n + 1);
    setBeat("anomaly");
  }, []);

  /** Any click or key is a user gesture: the moment sound is allowed. */
  const wakeSound = useCallback(() => {
    soundRef.current?.unlock();
  }, []);

  const advance = useCallback(() => {
    wakeSound();
    switch (beat) {
      case "panic":
        setBeat("boot");
        break;
      case "boot":
        setBeat("replay");
        break;
      case "replay":
        setBeat("bang");
        break;
      case "summon":
        if (line < crabLines.length - 1) setLine(line + 1);
        else setBeat("ascend");
        break;
      // anomaly, bang and ascend are too short to be worth skipping within.
    }
  }, [beat, line, crabLines.length, wakeSound]);

  const handleEscape = useCallback(() => {
    if (beat !== "crown") setBeat("crown");
    else dismiss();
  }, [beat, dismiss]);

  useModalDismiss(show, handleEscape);

  // "Press any key to reboot" means any key; elsewhere Space/Enter advance.
  useEffect(() => {
    if (!show || beat === "crown") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.repeat) return;
      // Enter/Space on the skip or sound button should press the button.
      if ((e.target as Element | null)?.closest?.("button, a, input")) return;
      if (beat === "panic" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, beat, advance]);

  const toggleSound = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      wakeSound();
      const next = !muted;
      setMuted(next);
      soundRef.current?.setMuted(next);
    },
    [muted, wakeSound]
  );

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

  const bootLines = BOOT_KEYS.map((key) => {
    const text =
      key === "memory"
        ? t("boot.memory", {
            tokens: formatTokensCompact(stats.totalTokens, locale),
          })
        : key === "treasury"
          ? t("boot.treasury", { cost: formatUsdWhole(stats.totalCost, locale) })
          : key === "leaderboard"
            ? t("boot.leaderboard", {
                rank: stats.rank,
                totalUsers: stats.totalUsers,
              })
            : t(`boot.${key}`);
    return { key, parts: splitStatus(text) };
  });

  const crowning = beat === "ascend" || beat === "crown";

  return createPortal(
    <div
      ref={rootRef}
      data-celebration="carcinization"
      data-beat={beat}
      className={`fixed inset-0 z-[9999] overflow-hidden ${
        beat === "anomaly" ? "bg-transparent" : "bg-black"
      } ${beat === "crown" ? "" : "cursor-pointer"}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("a11yLabel")}
      onClick={advance}
    >
      {reducedMotion && <div className="carc-static-bg absolute inset-0" aria-hidden="true" />}

      <div ref={shakeRef} className="absolute inset-0 flex items-center justify-center">
        <canvas
          ref={stageCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        />

        {/* ANOMALY: the page you were looking at breaks */}
        {beat === "anomaly" && (
          <>
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((b) => (
                <span
                  key={b}
                  className="carc-band"
                  style={{ "--b": b } as React.CSSProperties}
                />
              ))}
            </div>
            <div
              className="carc-scramble carc-glitch relative font-display font-extrabold leading-none"
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
            <div className="carc-crt-line" aria-hidden="true" />
            <div className="carc-crt-dot" aria-hidden="true" />
          </>
        )}

        {/* PANIC */}
        {beat === "panic" && (
          <div
            className="carc-glitch relative w-full max-w-2xl px-6 font-mono text-sm"
            style={{ "--line-gap": `${PANIC_LINE_GAP}s` } as React.CSSProperties}
          >
            <p
              className="carc-bootline carc-phosphor font-bold text-red-300"
              style={{ "--line-index": 0 } as React.CSSProperties}
            >
              *** {t("panic.title")} ***
            </p>
            <p
              className="carc-bootline carc-phosphor mt-3 text-red-400"
              style={{ "--line-index": 1 } as React.CSSProperties}
            >
              {t("panic.reason")}
            </p>
            <div className="mt-3 space-y-1 pl-6 text-red-400/80">
              {(["trace1", "trace2", "trace3"] as const).map((key, i) => (
                <p
                  key={key}
                  className="carc-bootline carc-phosphor"
                  style={{ "--line-index": i + 2 } as React.CSSProperties}
                >
                  {t(`panic.${key}`)}
                </p>
              ))}
            </div>
            <div
              className="carc-bootline mt-8"
              style={{ "--line-index": 6 } as React.CSSProperties}
            >
              <p className="carc-phosphor text-red-300">{t("panic.halted")}</p>
              <p className="carc-phosphor mt-2 font-bold text-foreground">
                <span className="carc-prompt-key">{t("panic.prompt")}</span>
                <span className="carc-prompt-touch">{t("panic.promptTouch")}</span>{" "}
                <span className="animate-blink">▮</span>
              </p>
              <p className="mt-4 text-[11px] text-white/40">
                <SpeakerIcon /> {t("sound.hint")}
              </p>
            </div>
          </div>
        )}

        {/* BOOT */}
        {beat === "boot" && (
          <div
            className="carc-boot w-full max-w-3xl px-6 font-mono text-xs sm:text-sm"
            style={
              {
                "--line-gap": `${BOOT_LINE_GAP}s`,
                "--line-base": `${BOOT_LINE_BASE}s`,
              } as React.CSSProperties
            }
          >
            <p
              className="carc-bootline carc-phosphor mb-5 font-bold text-accent-bright"
              style={{ "--line-index": 0 } as React.CSSProperties}
            >
              {t("boot.header")}
            </p>
            <div className="space-y-2.5">
              {bootLines.map(({ key, parts: [label, status] }, i) => (
                <p
                  key={key}
                  className="carc-bootline carc-phosphor text-accent/90"
                  style={{ "--line-index": i + 1 } as React.CSSProperties}
                >
                  {label}
                  {status && (
                    <>
                      <span className="text-accent/40"> .......... </span>
                      <span className={BOOT_STATUS_CLASS[key]}>{status}</span>
                    </>
                  )}
                </p>
              ))}
            </div>
            <span className="animate-blink mt-4 inline-block text-accent/70">▮</span>
          </div>
        )}

        {/* REPLAY: the counter over the grid (the grid itself is canvas) */}
        {beat === "replay" && (
          <div
            className="carc-hud pointer-events-none absolute inset-x-0 top-[8vh] flex flex-col items-center px-4 text-center"
            style={
              { "--implode-at": `${timeline.implodeStart}s` } as React.CSSProperties
            }
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.45em] text-muted sm:text-[11px]">
              {t("replay.label")}
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.35em] text-foreground/60">
              {t("replay.day")}
            </p>
            <p
              ref={counterRef}
              className="carc-counter font-display font-extrabold leading-none tabular-nums"
            >
              000
            </p>
            <p className="mt-3 flex h-5 items-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] sm:text-xs">
              <span ref={dateRef} className="text-foreground/50" />
              <span ref={tierRef} className="carc-tier font-bold" />
            </p>
          </div>
        )}

        {/* SUMMON: CLAWD PRIME speaks (the crab itself is canvas) */}
        {(beat === "summon" || beat === "ascend") && (
          <div
            className="carc-summon pointer-events-none absolute inset-0"
            data-leaving={beat === "ascend"}
          >
            <div className="carc-namecard absolute inset-x-0 top-[6vh] px-4 text-center">
              <p className="carc-infernal font-display text-xl font-extrabold uppercase tracking-[0.45em] text-red-500 sm:text-3xl">
                {t("crab.name")}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.45em] text-muted sm:text-[11px]">
                {t("crab.epithet")}
              </p>
            </div>
            <div
              className="absolute inset-x-0 bottom-[11vh] flex justify-center px-6"
              aria-live="polite"
            >
              {line >= 0 && (
                <Subtitle
                  key={line}
                  text={crabLines[line]}
                  final={line === crabLines.length - 1}
                />
              )}
            </div>
          </div>
        )}

        {/* CROWN — laid out (invisibly) during the ascent so the stage knows
            where the avatar will be, then revealed. Persists until dismissed. */}
        {crowning && (
          <div
            className="carc-crown relative z-10 flex max-w-2xl flex-col items-center px-6 text-center"
            data-live={beat === "crown"}
            onClick={(e) => e.stopPropagation()}
          >
            <div ref={avatarRef} className="carc-crown-avatar">
              <StreakAura streak={currentStreak} size="lg">
                {image ? (
                  <Image
                    src={image}
                    alt={username}
                    width={112}
                    height={112}
                    className="h-24 w-24 rounded-full sm:h-28 sm:w-28"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-surface-hover text-3xl font-bold text-muted sm:h-28 sm:w-28">
                    {username.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </StreakAura>
            </div>

            <p className="carc-crown-molt mt-7 font-mono text-[10px] uppercase tracking-[0.45em] text-muted sm:text-[11px]">
              {t("coronation.molt")}
            </p>
            <h2 className="carc-crown-title mt-2 max-w-[92vw] font-display text-[clamp(1.4rem,6vw,5.5rem)] font-extrabold uppercase leading-none">
              {t("coronation.title")}
            </h2>
            <p className="carc-crown-sub mt-4 font-mono text-base text-foreground sm:text-lg">
              {t("coronation.subtitle", { streak: currentStreak })}
            </p>

            <dl className="carc-crown-stats mt-7 grid grid-cols-3 gap-5 sm:gap-10">
              <Stat
                value={stats.totalTokens}
                format={(v) => formatTokensCompact(v, locale)}
                label={t("coronation.tokens")}
                animate={!reducedMotion && beat === "crown"}
              />
              <Stat
                value={stats.totalCost}
                format={(v) => formatUsdWhole(v, locale)}
                label={t("coronation.burned")}
                animate={!reducedMotion && beat === "crown"}
              />
              <Stat
                value={stats.rank}
                format={(v) => `#${Math.max(1, Math.round(v))}`}
                label={t("coronation.rankOf", { totalUsers: stats.totalUsers })}
                animate={!reducedMotion && beat === "crown"}
                countDown
              />
            </dl>

            <div className="carc-crown-share mt-8 flex flex-wrap items-center justify-center gap-2">
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

            <div className="carc-crown-dismiss mt-4 flex flex-wrap items-center justify-center gap-2">
              {!reducedMotion && (
                <button
                  onClick={replayShow}
                  className="rounded-lg border border-accent/40 bg-black/50 px-4 py-2 font-mono text-sm text-accent-bright/80 backdrop-blur transition-colors hover:border-accent hover:text-accent-bright"
                >
                  ↻ {t("coronation.replay")}
                </button>
              )}
              <button
                onClick={dismiss}
                className="rounded-lg border border-border bg-black/50 px-4 py-2 font-mono text-sm text-foreground/70 backdrop-blur transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {t("coronation.dismiss")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The crab rave */}
      {beat === "crown" && (
        <div className="carc-rave pointer-events-none absolute inset-x-0 bottom-3 h-12 sm:h-14" aria-hidden="true">
          {Array.from({ length: RAVE_DANCERS }, (_, i) => (
            <div
              key={i}
              className="carc-dancer"
              style={{ "--i": i } as React.CSSProperties}
            >
              <PixelCrab />
            </div>
          ))}
        </div>
      )}

      {/* CRT glass over the terminal beats */}
      {(beat === "panic" || beat === "boot") && (
        <div className="carc-crt pointer-events-none absolute inset-0" aria-hidden="true" />
      )}

      {/* Confetti canvas — above everything, never intercepts clicks */}
      <canvas
        key={take}
        ref={confettiCanvasRef}
        className="pointer-events-none absolute inset-0 z-20 h-full w-full"
        aria-hidden="true"
      />

      {beat !== "anomaly" && !reducedMotion && (
        <button
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={t("sound.toggle")}
          className="absolute right-4 top-4 z-30 inline-flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[11px] text-white/40 transition-colors hover:text-white/80"
        >
          <SpeakerIcon muted={muted} />
          {muted ? t("sound.off") : t("sound.on")}
        </button>
      )}

      {/* Always-visible skip (mobile has no Esc key) */}
      {beat !== "crown" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setBeat("crown");
          }}
          className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 font-mono text-xs text-white/30 transition-colors hover:text-white/60"
        >
          {t("skipHint")}
        </button>
      )}
    </div>,
    document.body
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** One of CLAWD PRIME's lines, each word resolving out of a blur. */
function Subtitle({ text, final }: { text: string; final: boolean }) {
  const words = text.split(" ");
  return (
    <p
      className={`max-w-3xl text-center font-display font-bold uppercase leading-snug ${
        final
          ? "carc-sub-final text-2xl text-accent-bright sm:text-4xl"
          : "text-lg text-foreground sm:text-2xl"
      }`}
    >
      {words.map((word, i) => (
        <span key={i}>
          <span className="carc-word" style={{ "--w": i } as React.CSSProperties}>
            {word}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </p>
  );
}

/** A coronation stat that counts up (or, for rank, down) into place. */
function Stat({
  value,
  format,
  label,
  animate,
  countDown = false,
}: {
  value: number;
  format: (v: number) => string;
  label: string;
  animate: boolean;
  countDown?: boolean;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const from = countDown ? Math.max(value * 12, value + 50) : 0;
    const start = performance.now() + 1200;
    const duration = 1700;
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - u, 4);
      setShown(from + (value - from) * eased);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, animate, countDown]);

  return (
    <div className="flex flex-col items-center">
      <dt className="order-2 mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
        {label}
      </dt>
      <dd className="order-1 font-display text-2xl font-extrabold tabular-nums text-foreground sm:text-3xl">
        {format(shown)}
      </dd>
    </div>
  );
}

function SpeakerIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block h-3 w-3 align-[-1px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M11 6l4 4M15 6l-4 4" strokeLinecap="round" />
      ) : (
        <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9" strokeLinecap="round" />
      )}
    </svg>
  );
}
