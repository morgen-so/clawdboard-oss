"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { RecapStories } from "./RecapStories";
import type { RecapRow } from "@/lib/db/recaps";

export function RecapBanner() {
  const t = useTranslations("recaps");
  const [recap, setRecap] = useState<RecapRow | null>(null);
  const [showStories, setShowStories] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recaps")
      .then((r) => r.json())
      .then((data: RecapRow[]) => {
        if (!cancelled && data.length > 0) {
          setRecap(data[0]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!recap || dismissed) return null;

  const label = recap.type === "weekly" ? t("weekly") : t("monthly");

  return (
    <>
      <button
        onClick={() => setShowStories(true)}
        className="group relative z-20 w-full overflow-hidden border-b border-accent/20 bg-accent/10 cursor-pointer"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 px-4 py-2.5">
          {/* Pulsing dot */}
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>

          <p className="font-mono text-xs text-foreground/80 group-hover:text-foreground transition-colors">
            {t.rich("bannerReady", {
              label,
              highlight: (chunks) => (
                <span className="text-accent font-semibold">{chunks}</span>
              ),
            })}{" "}
            <span className="text-muted">
              ({recap.periodStart} &mdash; {recap.periodEnd})
            </span>
          </p>

          {/* Arrow */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted group-hover:text-accent transition-colors shrink-0"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </button>

      {showStories && (
        <RecapStories
          recap={recap}
          onClose={() => {
            setShowStories(false);
            setDismissed(true);
            // Mark as seen
            fetch(`/api/recaps/${recap.id}/seen`, { method: "POST" }).catch(
              () => {}
            );
          }}
        />
      )}
    </>
  );
}
