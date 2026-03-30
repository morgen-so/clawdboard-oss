"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildTwitterIntentUrl,
  buildLinkedInShareUrl,
} from "@/lib/share";

interface ShareLeaderboardProps {
  topCost: string;
  leaderboardUrl: string;
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

export function ShareLeaderboard({ topCost, leaderboardUrl }: ShareLeaderboardProps) {
  const t = useTranslations("leaderboard");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareText = t("shareLeaderboardText", { topCost });

  const handleTwitter = () => {
    window.plausible?.("ShareLeaderboard", { props: { method: "twitter" } });
    window.open(
      buildTwitterIntentUrl(shareText, leaderboardUrl),
      "_blank",
      "noopener,noreferrer"
    );
    setOpen(false);
  };

  const handleLinkedIn = () => {
    window.plausible?.("ShareLeaderboard", { props: { method: "linkedin" } });
    window.open(
      buildLinkedInShareUrl(leaderboardUrl),
      "_blank",
      "noopener,noreferrer"
    );
    setOpen(false);
  };

  const handleCopy = async () => {
    window.plausible?.("ShareLeaderboard", { props: { method: "copy" } });
    await navigator.clipboard.writeText(`${shareText}\n${leaderboardUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border hover:border-border-bright text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer"
        aria-label={t("shareLeaderboard")}
      >
        <ShareIcon />
        <span className="hidden sm:inline">{t("shareLeaderboard")}</span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-border bg-surface shadow-lg py-1">
            <button
              onClick={handleTwitter}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Post to X
            </button>
            <button
              onClick={handleLinkedIn}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn
            </button>
            <button
              onClick={handleCopy}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-success">Copied!</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Copy link
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
