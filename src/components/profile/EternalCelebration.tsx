"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";
import { buildTwitterIntentUrl, buildLinkedInShareUrl } from "@/lib/share";
import { buildInviteUrl } from "@/lib/url";
import { env } from "@/lib/env";
import { getStreakTier } from "@/lib/streak-tiers";
import {
  CheckIcon,
  LinkIcon,
  LinkedInIcon,
  XIcon,
} from "@/components/icons/CommonIcons";
import { CarcSound } from "./carcinization/sound";
import { SpeakerIcon } from "./carcinization/SpeakerIcon";
import { DIAL_DAYS, EternalStage, type EternalPhase } from "./eternal/stage";

// ─── Eternal ────────────────────────────────────────────────────────────────
// The 100-day streak celebration. StreakCelebration owns the once-only gate
// and mounts this in place of its usual modal. About four seconds of show,
// then the card:
//
//   count  a dial of 100 ticks lights a day at a time, accelerating, each tick
//          in the colour of the tier the run was in that day (Spark → Inferno)
//   hold   99: hit-stop. The dial clenches and light pours in from the edges
//   burst  100: the ticks blow out as gold sparks and the dial whips round,
//          re-formed as the Eternal halo
//   crown  the dial rises and the card comes up under it; rays, glints,
//          embers. Stays until dismissed.
//
// A click, Space or Esc during the count skips to the hundredth. Silent unless
// the viewer turns sound on: nothing before it counts as a gesture that would
// let the browser play audio. Canvas work lives in ./eternal/stage.

interface EternalCelebrationProps {
  username: string;
  currentStreak: number;
  team?: {
    teamName: string;
    teamSlug: string;
    inviteToken: string;
  };
  onClose: () => void;
}

const SPARK_COLOR = getStreakTier(2).staticRingColor;

const shareBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-black/40 backdrop-blur hover:border-yellow-400/50 text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer";

export function EternalCelebration({
  username,
  currentStreak,
  team,
  onClose,
}: EternalCelebrationProps) {
  const t = useTranslations("eternal");
  const tp = useTranslations("profile");
  const [reducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [phase, setPhase] = useState<EternalPhase>(
    reducedMotion ? "crown" : "count"
  );
  const [muted, setMuted] = useState(true);
  /** Bumped by "replay": each take gets a fresh stage. */
  const [take, setTake] = useState(0);
  const { copied, copy: copyProfileUrl } = useCopyToClipboard();
  const { copied: inviteCopied, copy: copyInviteUrl } = useCopyToClipboard();

  const shakeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<EternalStage | null>(null);
  const soundRef = useRef<CarcSound | null>(null);
  const lastTierRef = useRef(-1);

  const counting = phase === "count" || phase === "hold";

  // Any other celebration that opened on this page view (the 100-day badge,
  // say) waits behind the show; see html[data-eternal] in globals.css.
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.eternal = "1";
    return () => {
      delete html.dataset.eternal;
    };
  }, []);

  // ── The counter: written straight to the DOM, up to once a frame ──
  const onDay = useCallback((day: number) => {
    const count = countRef.current;
    const label = tierRef.current;
    if (!count || !label) return;
    count.textContent = String(day);
    const tier = getStreakTier(day);
    if (tier.tier === lastTierRef.current) return;
    lastTierRef.current = tier.tier;
    const color = day === 0 ? "var(--dim)" : tier.tier === 0 ? SPARK_COLOR : tier.staticRingColor;
    count.style.color = color;
    label.style.color = color;
    label.textContent = tier.tier === 0 ? "" : tier.name;
    if (tier.tier === 0) return;
    label.animate?.(
      [
        { transform: "scale(1.9)", opacity: 0, filter: "blur(6px)" },
        { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,1.4,.4,1)" }
    );
    count.animate?.(
      [{ transform: "scale(1.16)" }, { transform: "scale(1)" }],
      { duration: 320, easing: "ease-out" }
    );
  }, []);

  // ── Sound lives for the whole celebration, so a replay keeps it unlocked ──
  useEffect(() => {
    if (reducedMotion) return;
    const sound = new CarcSound();
    soundRef.current = sound;
    return () => {
      sound.dispose();
      soundRef.current = null;
    };
  }, [reducedMotion]);

  // ── A fresh stage per take ──
  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const dialEl = dialRef.current;
    const liftEl = liftRef.current;
    const sound = soundRef.current;
    if (!canvas || !dialEl || !liftEl || !sound) return;
    lastTierRef.current = -1;
    const stage = new EternalStage(canvas, {
      dialEl,
      liftEl,
      shakeEl: shakeRef.current,
      sound,
      onDay,
      onPhase: setPhase,
    });
    stageRef.current = stage;
    stage.start();
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
  }, [reducedMotion, take, onDay]);

  // Keyboard users land on the way out once the card is up.
  useEffect(() => {
    if (phase === "crown") continueRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // ── Input ──
  const skip = useCallback(() => stageRef.current?.skip(), []);

  const handleEscape = useCallback(() => {
    if (counting) skip();
    else onClose();
  }, [counting, skip, onClose]);

  useModalDismiss(true, handleEscape);

  // Space and Enter skip the count too (Esc is handled above).
  useEffect(() => {
    if (!counting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Enter/Space on the sound button should press the button.
      if ((e.target as Element | null)?.closest?.("button, a, input")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        skip();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [counting, skip]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (counting) skip();
      else if (phase === "crown" && !liftRef.current?.contains(e.target as Node)) onClose();
    },
    [counting, phase, skip, onClose]
  );

  const toggleSound = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const sound = soundRef.current;
      if (!sound) return;
      sound.unlock();
      const next = !muted;
      setMuted(next);
      sound.setMuted(next);
      // Turned on after the fact: play it the chord it missed.
      if (!next && phase === "crown") sound.fanfare();
    },
    [muted, phase]
  );

  const replay = useCallback(() => {
    window.plausible?.("EternalReplay");
    setPhase("count");
    setTake((n) => n + 1);
  }, []);

  // ── Share ──
  const profileUrl = `https://clawdboard.ai/user/${username}`;
  const shareText = t("shareText", { streak: currentStreak });

  const handleTwitter = useCallback(() => {
    window.plausible?.("StreakShare", { props: { method: "twitter" } });
    window.open(
      buildTwitterIntentUrl(shareText, profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  }, [shareText, profileUrl]);

  const handleLinkedIn = useCallback(() => {
    window.plausible?.("StreakShare", { props: { method: "linkedin" } });
    window.open(
      buildLinkedInShareUrl(profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  }, [profileUrl]);

  const handleCopyLink = useCallback(async () => {
    window.plausible?.("StreakShare", { props: { method: "copy_link" } });
    await copyProfileUrl(profileUrl);
  }, [profileUrl, copyProfileUrl]);

  const inviteUrl = team
    ? buildInviteUrl(env.NEXT_PUBLIC_BASE_URL, team.teamSlug, team.inviteToken)
    : null;

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    window.plausible?.("Invite_Copied", { props: { source: "streak_celebration" } });
    await copyInviteUrl(inviteUrl);
  }, [inviteUrl, copyInviteUrl]);

  return createPortal(
    <div
      data-celebration="eternal"
      data-phase={phase}
      data-static={reducedMotion || undefined}
      className={`eternal-root fixed inset-0 z-[9999] overflow-hidden bg-black/90 backdrop-blur-md ${
        counting ? "cursor-pointer" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={t("a11yLabel")}
      onClick={handleBackdrop}
    >
      {reducedMotion && <div className="eternal-static-bg absolute inset-0" aria-hidden="true" />}

      <div ref={shakeRef} className="absolute inset-0">
        <canvas
          key={take}
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        />

        <div className="absolute inset-0 flex overflow-y-auto overscroll-contain">
          <div ref={liftRef} className="m-auto flex flex-col items-center px-4 py-8 text-center">
            <div
              ref={dialRef}
              className="eternal-dial relative flex flex-col items-center justify-center"
            >
              {reducedMotion && (
                <div className="eternal-static-ring absolute inset-[6%]" aria-hidden="true" />
              )}
              <span
                key={`count-${take}`}
                ref={countRef}
                className="eternal-count eternal-live font-display font-extrabold tabular-nums"
                aria-hidden="true"
              />
              <span
                key={`tier-${take}`}
                ref={tierRef}
                className="eternal-tier eternal-live font-mono"
                aria-hidden="true"
              />
              <span className="eternal-count eternal-final eternal-gold font-display font-extrabold">
                {DIAL_DAYS}
              </span>
              <span className="eternal-tier eternal-final font-mono text-yellow-100/60">
                {t("days")}
              </span>
            </div>

            <p
              className="eternal-reveal mt-5 font-mono text-[10px] uppercase tracking-[0.45em] text-yellow-200/60 sm:text-[11px]"
              style={{ "--d": 0 } as React.CSSProperties}
            >
              ✦ {t("eyebrow")} ✦
            </p>
            <h2 className="eternal-reveal eternal-title eternal-gold mt-2 font-display text-[clamp(2.6rem,11vw,5.25rem)] font-extrabold uppercase leading-none">
              {t("title")}
            </h2>
            <p
              className="eternal-reveal mt-4 max-w-md font-mono text-sm text-foreground/90 sm:text-base"
              style={{ "--d": 380 } as React.CSSProperties}
            >
              {t("body", { streak: currentStreak })}
            </p>
            <p
              className="eternal-reveal mt-2 font-mono text-xs text-dim"
              style={{ "--d": 520 } as React.CSSProperties}
            >
              {t("teaser")}
            </p>

            <div
              className="eternal-reveal mt-7 flex flex-wrap items-center justify-center gap-2"
              style={{ "--d": 680 } as React.CSSProperties}
            >
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

            {team && (
              <button
                onClick={handleCopyInvite}
                className="eternal-reveal mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-foreground cursor-pointer"
                style={{ "--d": 760 } as React.CSSProperties}
              >
                {inviteCopied ? (
                  <>
                    <CheckIcon />
                    <span className="text-success">{tp("copied")}</span>
                  </>
                ) : (
                  <>
                    <LinkIcon />
                    {t("inviteTeam", { teamName: team.teamName })}
                  </>
                )}
              </button>
            )}

            <div
              className="eternal-reveal mt-5 flex flex-wrap items-center justify-center gap-2"
              style={{ "--d": 840 } as React.CSSProperties}
            >
              {!reducedMotion && (
                <button
                  onClick={replay}
                  className="rounded-lg border border-yellow-400/30 bg-black/50 px-4 py-2 font-mono text-sm text-yellow-200/80 backdrop-blur transition-colors hover:border-yellow-400/70 hover:text-yellow-100 cursor-pointer"
                >
                  ↻ {t("replay")}
                </button>
              )}
              <button
                ref={continueRef}
                onClick={onClose}
                className="rounded-lg border border-border bg-black/50 px-4 py-2 font-mono text-sm text-foreground/70 backdrop-blur transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer"
              >
                {t("dismiss")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!reducedMotion && (
        <button
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={t("sound.toggle")}
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[11px] text-white/40 transition-colors hover:text-white/80 cursor-pointer"
        >
          <SpeakerIcon muted={muted} />
          {muted ? t("sound.off") : t("sound.on")}
        </button>
      )}
    </div>,
    document.body
  );
}
