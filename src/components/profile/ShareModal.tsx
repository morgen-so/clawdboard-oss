"use client";

import { useRef, useState } from "react";
import { ShareCard } from "./ShareCard";
import { useTranslations } from "next-intl";
import { CheckIcon, DownloadIcon, LinkIcon, LinkedInIcon, XIcon } from "@/components/icons/CommonIcons";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";
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
  const { copied, copy } = useCopyToClipboard();
  const [downloading, setDownloading] = useState(false);

  useModalDismiss(open, onClose);

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
    await copy(profileUrl);
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
            <DownloadIcon size={16} />
            {downloading ? t("saving") : t("downloadPng")}
          </button>
          <button onClick={handleTwitter} className={secondaryBtn}>
            <XIcon size={16} />
            {t("shareOnTwitter")}
          </button>
          <button onClick={handleLinkedIn} className={secondaryBtn}>
            <LinkedInIcon size={16} />
            {t("shareOnLinkedIn")}
          </button>
          <button onClick={handleCopyLink} className={secondaryBtn}>
            {copied ? (
              <>
                <CheckIcon size={16} />
                <span className="text-success">{t("copied")}</span>
              </>
            ) : (
              <>
                <LinkIcon size={16} />
                {t("copyLink")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
