"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { CopyIconButton } from "./CopyIconButton";

const DEFAULT_INTERVAL_MS = 7_200_000; // 2 hours
const POLL_INTERVAL_MS = 90_000; // 90 seconds
const MAX_POLLS = 7; // ~10 minutes of polling

interface SyncCountdownProps {
  lastSyncAt: string; // ISO timestamp
  syncIntervalMs?: number;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function SyncNowTip() {
  const t = useTranslations("leaderboard");
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const visible = pinned || hovered;

  useEffect(() => {
    if (!pinned) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPinned(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPinned(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        className="cursor-help text-muted/70 hover:text-muted transition-colors"
        aria-label={t("syncManually")}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0 pb-2 flex flex-col items-center">
          <span className="flex items-center gap-2 whitespace-nowrap rounded border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg animate-[tooltipIn_150ms_ease-out]">
            <span className="text-muted">{t("toSyncManually")}</span>
            <span className="inline-flex items-center gap-2 rounded border border-border bg-background px-2 py-0.5">
              <span className="text-dim/60 select-none">$</span>
              <code className="text-foreground/70">npx clawdboard sync</code>
              <CopyIconButton text="npx clawdboard sync" />
            </span>
            <span className="text-muted">{t("inYourTerminal")}</span>
          </span>
        </span>
      )}
    </span>
  );
}

export function SyncCountdown({
  lastSyncAt,
  syncIntervalMs = DEFAULT_INTERVAL_MS,
}: SyncCountdownProps) {
  const router = useRouter();
  const t = useTranslations("leaderboard");
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const lastSyncAtRef = useRef(lastSyncAt);
  const wasEligibleRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const updatedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const pollExhausted = pollCount >= MAX_POLLS;

  // Detect data arrival -> flash "updated!" for 2s then reset
  useEffect(() => {
    if (lastSyncAt !== lastSyncAtRef.current) {
      lastSyncAtRef.current = lastSyncAt;
      setRefreshing(false);
      setPollCount(0);
      setJustUpdated(true);
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
      updatedTimerRef.current = setTimeout(() => setJustUpdated(false), 2000);
    }
  }, [lastSyncAt]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
    };
  }, []);

  const lastSyncMs = new Date(lastSyncAt).getTime();
  const nextEligibleAt = lastSyncMs + syncIntervalMs;
  const remaining = nextEligibleAt - now;
  const isEligible = remaining <= 0;

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 3000);
  }, [router]);

  // Auto-refresh once when countdown hits zero
  useEffect(() => {
    if (isEligible && !wasEligibleRef.current) {
      doRefresh();
    }
    wasEligibleRef.current = isEligible;
  }, [isEligible, doRefresh]);

  // Tick every second while counting down
  useEffect(() => {
    if (isEligible) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [isEligible]);

  // Auto-poll every 90s while eligible, capped at MAX_POLLS
  useEffect(() => {
    if (!isEligible || pollExhausted) return;
    const interval = setInterval(() => {
      setPollCount((c) => c + 1);
      doRefresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEligible, pollExhausted, doRefresh]);

  const handleRefresh = () => {
    if (pollExhausted) setPollCount(0); // restart polling on manual click
    doRefresh();
  };

  return (
    <div className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted">
      {justUpdated ? (
        <>
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-green-400">
            <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-75" />
          </span>
          <span className="text-green-400">{t("updated")}</span>
        </>
      ) : isEligible ? (
        <>
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-accent">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-75" />
          </span>
          <span>
            {pollExhausted
              ? t("statsMayHaveUpdated")
              : t("checkingForUpdates")}
          </span>
          <span>·</span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-accent underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
          >
            {refreshing ? t("checking") : `${t("refresh")} \u21BB`}
          </button>
          <SyncNowTip />
        </>
      ) : (
        <>
          <span>
            {t("nextSyncIn")}{" "}
            <span className="text-accent">{formatCountdown(remaining)}</span>
          </span>
          <SyncNowTip />
        </>
      )}
    </div>
  );
}
