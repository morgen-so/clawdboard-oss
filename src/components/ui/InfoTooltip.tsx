"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const t = useTranslations("common");
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const updatePos = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top,
      left: rect.left + rect.width / 2,
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    updatePos();
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setVisible(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [visible, updatePos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setVisible((v) => !v)}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="inline-flex text-muted hover:text-foreground transition-colors"
        aria-label={t("moreInfo")}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 11V7.5" />
          <circle cx="8" cy="5.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {visible &&
        pos &&
        createPortal(
          <span
            style={{ top: pos.top, left: pos.left }}
            className="fixed -translate-x-1/2 -translate-y-full -mt-2 w-56 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-lg animate-[tooltipIn_150ms_ease-out] z-50 text-center leading-relaxed pointer-events-none"
          >
            {text}
          </span>,
          document.body
        )}
    </>
  );
}
