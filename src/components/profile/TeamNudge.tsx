"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const DISMISS_KEY = "clawdboard:team-nudge-dismissed";

export function TeamNudge() {
  const t = useTranslations("profile");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03]">
      <div className="px-4 pt-3 pb-1">
        <span className="font-mono text-[10px] tracking-widest text-accent/60 font-medium">
          <span className="text-accent/40 select-none">$ </span>team
        </span>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <span className="font-mono text-sm text-foreground/80">
          {t("teamNudge")}
        </span>

        <Link
          href="/my-team"
          className="ml-auto font-mono text-sm font-medium text-accent transition-colors hover:text-accent/80 whitespace-nowrap"
        >
          {t("createOrJoin")} &rarr;
        </Link>

        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setVisible(false);
          }}
          className="shrink-0 rounded p-1 text-foreground/30 transition-colors hover:text-foreground cursor-pointer"
          aria-label={t("dismissTeamNudge")}
        >
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
