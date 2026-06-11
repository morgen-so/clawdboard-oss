"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { buildBadgeSnippet } from "@/lib/badge";
import { dismissBadgePrompt } from "@/actions/users";
import { CheckIcon, CloseIcon, CopyIcon } from "@/components/icons/CommonIcons";
import { useModalDismiss } from "@/components/ui/useModalDismiss";

const VISIT_KEY = "clawdboard:visit-count";
const DISMISS_KEY = "clawdboard:badge-prompt-dismissed";
const SHOW_AFTER_VISITS = 3;

interface BadgePromptProps {
  username: string;
  baseUrl: string;
}

function StepDots({
  current,
  onNavigate,
}: {
  current: number;
  onNavigate: (step: 1 | 2 | 3) => void;
}) {
  const t = useTranslations("badgePrompt");
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {([1, 2, 3] as const).map((s) => (
        <button
          key={s}
          onClick={() => s < current && onNavigate(s)}
          className={`w-2 h-2 rounded-full transition-colors ${
            s === current
              ? "bg-accent"
              : s < current
                ? "bg-foreground/40 hover:bg-foreground/60 cursor-pointer"
                : "bg-foreground/20"
          }`}
          aria-label={t("goToStep", { step: s })}
          aria-current={s === current ? "step" : undefined}
        />
      ))}
    </div>
  );
}

/* ── Confetti ─────────────────────────────────────── */

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
            bottom: "15%",
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

/* ── Step 1: Hook ─────────────────────────────────── */

function StepHook({
  username,
  badgeUrl,
  onNext,
}: {
  username: string;
  badgeUrl: string;
  onNext: () => void;
}) {
  const t = useTranslations("badgePrompt");

  useEffect(() => {
    window.plausible?.("Badge_View");
  }, []);

  return (
    <>
      <h2 className="font-display text-lg font-bold text-foreground mb-3">
        {t("addBadgeTitle")}
      </h2>

      {/* GitHub README mockup */}
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#30363d] text-[#8b949e] text-xs">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
          </svg>
          README.md
        </div>
        <div className="p-4 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={badgeUrl}
            alt="clawdboard badge preview"
            height={28}
            className="h-7"
          />
          <p className="text-[#e6edf3] text-sm">
            Hi, I&apos;m @{username}{" "}
            <span aria-hidden="true">&#128075;</span>
          </p>
          <div className="space-y-1">
            <div className="h-2.5 bg-[#161b22] rounded w-3/4" />
            <div className="h-2.5 bg-[#161b22] rounded w-1/2" />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted mb-5">
        {t("flexStats")}
      </p>

      <button
        onClick={onNext}
        className="w-full py-2 rounded bg-accent hover:bg-accent/90 text-background text-sm font-mono font-semibold transition-colors cursor-pointer"
      >
        {t("showMeHow")} &rarr;
      </button>
    </>
  );
}

/* ── Step 2: Copy ─────────────────────────────────── */

function StepCopy({
  badgeUrl,
  snippet,
  onNext,
}: {
  badgeUrl: string;
  snippet: string;
  onNext: () => void;
}) {
  const t = useTranslations("badgePrompt");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    window.plausible?.("Badge_Copy");
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    timerRef.current = setTimeout(() => {
      onNext();
    }, 1200);
  };

  return (
    <>
      <h2 className="font-display text-lg font-bold text-foreground mb-4">
        {t("copyMarkdownTitle")}
      </h2>

      {/* Live badge preview */}
      <div className="mb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={badgeUrl}
          alt="clawdboard badge preview"
          height={28}
          className="h-7"
        />
      </div>

      {/* Markdown snippet */}
      <code className="block rounded border border-border bg-background p-3 text-xs font-mono text-foreground/70 break-all leading-relaxed mb-4">
        {snippet}
      </code>

      <button
        onClick={handleCopy}
        disabled={copied}
        className={`w-full py-2 rounded text-sm font-mono font-semibold transition-colors cursor-pointer ${
          copied
            ? "bg-success/20 text-success border border-success/30"
            : "bg-accent hover:bg-accent/90 text-background"
        }`}
      >
        {copied ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <CheckIcon />
            {t("copied")}
          </span>
        ) : (
          <span className="inline-flex items-center justify-center gap-1.5">
            <CopyIcon />
            {t("copyMarkdown")}
          </span>
        )}
      </button>
    </>
  );
}

/* ── Step 3: Paste instructions ───────────────────── */

function StepPaste({
  username,
  onDone,
}: {
  username: string;
  onDone: () => void;
}) {
  const t = useTranslations("badgePrompt");
  const [showConfetti, setShowConfetti] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const profileUrl = `https://github.com/${username}`;
  const createRepoUrl = `https://github.com/new?name=${encodeURIComponent(username)}&description=${encodeURIComponent("My GitHub profile README")}`;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleOpenProfile = () => {
    window.plausible?.("Badge_Open_Repo");
    window.open(profileUrl, "_blank", "noopener,noreferrer");
  };

  const handleDone = () => {
    setShowConfetti(true);
    timerRef.current = setTimeout(onDone, 1000);
  };

  return (
    <>
      {showConfetti && <Confetti />}

      <h2 className="font-display text-lg font-bold text-foreground mb-4">
        {t("pasteTitle")}
      </h2>

      <ol className="space-y-3 text-sm text-foreground/80 mb-5 list-none">
        <li className="flex gap-3">
          <span className="flex-none w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
            1
          </span>
          <span>{t("goToProfileReadme", { username })}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex-none w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
            2
          </span>
          <span>
            {t("editReadme")}
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex-none w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
            3
          </span>
          <span>{t("pasteBadgeTop")}</span>
        </li>
      </ol>

      <button
        onClick={handleOpenProfile}
        className="w-full py-2 rounded bg-accent hover:bg-accent/90 text-background text-sm font-mono font-semibold transition-colors cursor-pointer mb-2"
      >
        {t("openMyProfile")} &rarr;
      </button>

      <p className="text-xs text-muted text-center mb-3">
        {t("noProfileRepo")}{" "}
        <a
          href={createRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {t("createOne")}
        </a>
      </p>

      <button
        onClick={handleDone}
        className="w-full py-1.5 text-xs text-muted hover:text-foreground font-mono transition-colors cursor-pointer"
      >
        {t("done")}
      </button>
    </>
  );
}

/* ── Shared wizard modal ──────────────────────────── */

export function BadgeWizardModal({
  open,
  onClose,
  username,
  baseUrl,
  initialStep = 1,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  baseUrl: string;
  initialStep?: 1 | 2 | 3;
}) {
  const t = useTranslations("badgePrompt");
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const { badgeUrl, snippet } = buildBadgeSnippet(username, baseUrl);

  // Reset step when modal opens
  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  useModalDismiss(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md bg-surface border border-border rounded-lg overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t("addBadgeTitle")}
        style={{ animation: "fadeInUp 0.2s ease-out" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-muted hover:text-foreground transition-colors cursor-pointer z-10"
          aria-label={t("close")}
        >
          <CloseIcon />
        </button>

        <div className="px-6 pt-5 pb-6">
          <StepDots current={step} onNavigate={setStep} />

          {step === 1 && (
            <StepHook
              username={username}
              badgeUrl={badgeUrl}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepCopy
              badgeUrl={badgeUrl}
              snippet={snippet}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <StepPaste username={username} onDone={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── BadgePrompt (auto-triggered by visit count) ──── */

export function BadgePrompt({ username, baseUrl }: BadgePromptProps) {
  const [visible, setVisible] = useState(false);

  // Session counting — only increment once per browser session (tab/window),
  // so navigating back and forth within a single visit doesn't inflate the count.
  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const SESSION_KEY = "clawdboard:session-counted";
    let count = parseInt(localStorage.getItem(VISIT_KEY) ?? "0", 10);

    if (!sessionStorage.getItem(SESSION_KEY)) {
      count += 1;
      localStorage.setItem(VISIT_KEY, String(count));
      sessionStorage.setItem(SESSION_KEY, "1");
    }

    if (count < SHOW_AFTER_VISITS) return;

    // Brief delay to avoid jarring popup on page load
    const timer = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
    dismissBadgePrompt().catch(() => {});
  }, []);

  return (
    <BadgeWizardModal
      open={visible}
      onClose={dismiss}
      username={username}
      baseUrl={baseUrl}
      initialStep={1}
    />
  );
}
