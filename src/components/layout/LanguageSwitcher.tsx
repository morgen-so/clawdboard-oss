"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useEffect, useRef, useState } from "react";

const localeNames: Record<string, string> = {
  en: "English",
  fr: "Francais",
  de: "Deutsch",
  es: "Espanol",
};

export function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative z-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        aria-label={t("changeLanguage")}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
        </svg>
        {locale.toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded border border-border bg-surface shadow-lg z-50">
          {routing.locales.map((l) => (
            <button
              key={l}
              onClick={() => {
                router.replace(pathname, { locale: l });
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left font-mono text-sm transition-colors hover:bg-surface-hover ${
                l === locale
                  ? "font-bold text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {localeNames[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
