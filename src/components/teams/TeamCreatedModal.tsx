"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CloseIcon, CopyIcon } from "@/components/icons/CommonIcons";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";

/* ── Icons ───────────────────────────────────────────── */

function MailIcon() {
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
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function SlackIcon() {
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
      <rect x="13" y="2" width="3" height="8" rx="1.5" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" />
      <rect x="8" y="14" width="3" height="8" rx="1.5" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" />
      <rect x="14" y="13" width="8" height="3" rx="1.5" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" />
      <rect x="2" y="8" width="8" height="3" rx="1.5" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" />
    </svg>
  );
}

/* ── Confetti ────────────────────────────────────────── */

const CONFETTI_COLORS = [
  "#F9A615",
  "#22c55e",
  "#3b82f6",
  "#ec4899",
  "#a855f7",
  "#f97316",
];

function Confetti() {
  const particles = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const angle = (i / 30) * 360 + (Math.random() * 20 - 10);
        const distance = 60 + Math.random() * 100;
        const x = Math.cos((angle * Math.PI) / 180) * distance;
        const y = Math.sin((angle * Math.PI) / 180) * distance - 40;
        const r = Math.random() * 540 - 270;
        return {
          x,
          y,
          r,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: Math.random() * 0.15,
          size: 3 + Math.random() * 5,
          round: Math.random() > 0.5,
        };
      }),
    []
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-visible"
      aria-hidden="true"
    >
      {particles.map((p, i) => (
        <div
          key={i}
          className={p.round ? "rounded-full" : ""}
          style={{
            position: "absolute",
            left: "50%",
            top: "20%",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animation: `confetti-pop 0.9s ease-out ${p.delay}s both`,
            "--x": `${p.x}px`,
            "--y": `${p.y}px`,
            "--r": `${p.r}deg`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ── TeamCreatedModal ────────────────────────────────── */

interface TeamCreatedModalProps {
  teamName: string;
  inviteUrl: string;
}

export function TeamCreatedModal({
  teamName,
  inviteUrl,
}: TeamCreatedModalProps) {
  const [visible, setVisible] = useState(true);
  const { copied: copiedLink, copy: copyLink } = useCopyToClipboard();
  const { copied: copiedSlack, copy: copySlack } = useCopyToClipboard();
  const t = useTranslations("team");
  const tCommon = useTranslations("common");

  const handleClose = useCallback(() => {
    setVisible(false);
    document.body.style.overflow = "";
    // Clean URL so refresh doesn't re-show modal
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useModalDismiss(visible, handleClose);

  const handleCopyLink = async () => {
    await copyLink(inviteUrl);
  };

  const handleCopySlack = async () => {
    await copySlack(t("slackMessage", { url: inviteUrl }));
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(t("emailSubject"));
    const body = encodeURIComponent(t("emailBody", { url: inviteUrl }));
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="relative w-full max-w-md bg-surface border border-border rounded-lg overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t("teamCreatedHeading", { teamName })}
        style={{ animation: "fadeInUp 0.2s ease-out" }}
      >
        {/* Confetti burst */}
        <Confetti />

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-1 text-muted hover:text-foreground transition-colors cursor-pointer z-10"
          aria-label={tCommon("close")}
        >
          <CloseIcon />
        </button>

        <div className="px-6 pt-5 pb-6">
          {/* Terminal heading */}
          <p className="font-mono text-xs text-muted mb-4">{t("teamCreatedTerminal")}</p>

          {/* Team name */}
          <h2 className="font-display text-xl font-bold text-foreground mb-2">
            {t("teamCreatedHeading", { teamName })}
          </h2>

          {/* Invite section */}
          <p className="text-sm text-muted mb-3">
            {t("shareInviteLink")}
          </p>

          {/* Invite URL display */}
          <div className="rounded border border-border bg-background px-3 py-2 mb-4">
            <code className="text-xs font-mono text-foreground/70 break-all">
              {inviteUrl}
            </code>
          </div>

          {/* Primary CTA: Copy Link */}
          <button
            onClick={handleCopyLink}
            className={`w-full py-2.5 rounded text-sm font-mono font-semibold transition-colors cursor-pointer mb-3 ${
              copiedLink
                ? "bg-success/20 text-success border border-success/30"
                : "bg-accent hover:bg-accent/90 text-background"
            }`}
          >
            {copiedLink ? (
              <span className="inline-flex items-center justify-center gap-1.5">
                <CheckIcon />
                {t("copied")}
              </span>
            ) : (
              <span className="inline-flex items-center justify-center gap-1.5">
                <CopyIcon />
                {t("copyLink")}
              </span>
            )}
          </button>

          {/* Secondary CTAs */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={handleCopySlack}
              className={`py-2 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                copiedSlack
                  ? "bg-success/20 text-success border border-success/30"
                  : "border border-border hover:border-border-bright text-muted hover:text-foreground"
              }`}
            >
              {copiedSlack ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <CheckIcon />
                  {t("copied")}
                </span>
              ) : (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <SlackIcon />
                  {t("copyForSlack")}
                </span>
              )}
            </button>
            <button
              onClick={handleEmail}
              className="py-2 rounded border border-border hover:border-border-bright text-muted hover:text-foreground text-xs font-mono font-semibold transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <MailIcon />
                {t("emailInvite")}
              </span>
            </button>
          </div>

          {/* Dismiss link */}
          <button
            onClick={handleClose}
            className="w-full py-1.5 text-xs text-muted hover:text-foreground font-mono transition-colors cursor-pointer"
          >
            {t("doThisLater")} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
