"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ShareCard } from "./ShareCard";
import { useTranslations } from "next-intl";
import {
  buildShareText,
  buildTwitterIntentUrl,
  buildLinkedInShareUrl,
} from "@/lib/share";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
  image: string | null;
  totalCost: string;
  totalTokens: number;
  rank: number;
  totalUsers: number;
  percentile: number;
  streak: number;
  profileUrl: string;
}

/** X/Twitter logo */
function XIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** LinkedIn logo */
function LinkedInIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/** Link/chain icon */
function LinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Checkmark icon */
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Download icon */
function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

const secondaryBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:border-border-bright text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer";

export function ShareModal({
  open,
  onClose,
  username,
  image,
  totalCost,
  totalTokens,
  rank,
  totalUsers,
  percentile,
  streak,
  profileUrl,
}: ShareModalProps) {
  const t = useTranslations("profile");
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const shareText = buildShareText(rank, streak, totalCost, totalUsers);

  const handleDownload = async () => {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    window.plausible?.("Share", { props: { method: "download" } });
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(cardRef.current, {
        width: 1200,
        height: 630,
        pixelRatio: 1,
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = `clawdboard-${username}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to generate image:", err);
    } finally {
      setDownloading(false);
    }
  };

  const handleTwitter = () => {
    window.plausible?.("Share", { props: { method: "twitter" } });
    window.open(
      buildTwitterIntentUrl(shareText, profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleLinkedIn = () => {
    window.plausible?.("Share", { props: { method: "linkedin" } });
    window.open(
      buildLinkedInShareUrl(profileUrl),
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleCopyLink = async () => {
    window.plausible?.("Share", { props: { method: "copy_link" } });
    await navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[680px] bg-surface border border-border rounded-lg animate-in fade-in slide-in-from-bottom-4 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Share your stats"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="font-display text-lg font-bold text-foreground">
            {t("shareProfile")}
          </h2>
          <p className="text-xs text-muted mt-1">
            {t("shareDescription")}
          </p>
        </div>

        {/* Card preview — render at full size, scale down to fit */}
        <div className="px-6 pb-4">
          <div
            className="overflow-hidden rounded-lg border border-border"
            style={{
              /* Scale 1200px card to fit ~632px container (680 - 48px padding) */
              height: `calc(630 * (100% / 1200))`,
              position: "relative",
            }}
          >
            <div
              style={{
                transform: "scale(var(--card-scale, 0.527))",
                transformOrigin: "top left",
                width: 1200,
                height: 630,
              }}
              ref={(el) => {
                // Compute scale dynamically based on container width
                if (el?.parentElement) {
                  const containerWidth = el.parentElement.clientWidth;
                  const scale = containerWidth / 1200;
                  el.style.setProperty("--card-scale", String(scale));
                  el.parentElement.style.height = `${630 * scale}px`;
                }
              }}
            >
              <ShareCard
                ref={cardRef}
                username={username}
                image={image}
                totalCost={totalCost}
                totalTokens={totalTokens}
                rank={rank}
                totalUsers={totalUsers}
                percentile={percentile}
                streak={streak}
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-6 pb-5 flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent hover:bg-accent/90 text-background text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <DownloadIcon />
            {downloading ? t("saving") : t("downloadPng")}
          </button>
          <button onClick={handleTwitter} className={secondaryBtn}>
            <XIcon />
            {t("shareOnTwitter")}
          </button>
          <button onClick={handleLinkedIn} className={secondaryBtn}>
            <LinkedInIcon />
            {t("shareOnLinkedIn")}
          </button>
          <button onClick={handleCopyLink} className={secondaryBtn}>
            {copied ? (
              <>
                <CheckIcon />
                <span className="text-success">{t("copied")}</span>
              </>
            ) : (
              <>
                <LinkIcon />
                {t("copyLink")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
