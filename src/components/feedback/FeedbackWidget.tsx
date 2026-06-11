"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { submitFeedback } from "@/actions/feedback";

export function FeedbackWidget() {
  const t = useTranslations("feedback");
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-accent/40 bg-zinc-900/95 px-4 py-2.5 text-sm font-medium text-zinc-200 shadow-lg shadow-accent/10 backdrop-blur transition-all hover:border-accent/70 hover:shadow-accent/20 hover:text-white cursor-pointer"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {t("button")}
        </button>
      )}
      {open && <FeedbackForm onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("feedback");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Stable close ref to avoid stale closures
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stableClose = useCallback(() => onCloseRef.current(), []);

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") stableClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [stableClose]);

  // Auto-close after success
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(stableClose, 2000);
    return () => clearTimeout(timer);
  }, [success, stableClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const result = await submitFeedback(message, email || undefined);
    setSubmitting(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    setSuccess(true);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-end bg-black/60 backdrop-blur-sm p-4 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) stableClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-zinc-700/80 bg-zinc-900/95 shadow-2xl">
        {success ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-accent">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm text-zinc-300">
              {t("success")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="border-b border-zinc-700/80 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-200 font-mono">
                <span className="text-accent">$</span> {t("title")}
              </h2>
            </div>

            <div className="space-y-3 p-4">
              <p className="text-xs text-zinc-500">
                {t("intro")}
              </p>

              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("messagePlaceholder")}
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                className="w-full rounded border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none"
              />

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full rounded border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-zinc-700/80 px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-accent px-4 py-1.5 text-xs font-semibold text-zinc-900 transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? t("sending") : t("send")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
