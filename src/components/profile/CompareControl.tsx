"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

interface SearchResult {
  id: string;
  github_username: string | null;
  name: string | null;
  image: string | null;
}

interface CompareControlProps {
  /** GitHub username of the profile owner (the primary series). */
  primaryUsername: string;
  /** Username currently overlaid via ?vs=, or null when not comparing. */
  currentVs: string | null;
  /** Display label for the compare user (for the active chip). */
  compareLabel: string | null;
  /** Whether the viewer is signed in — required to use the search API. */
  canSearch: boolean;
}

/**
 * Chart-header control for the usage comparison overlay.
 *
 * - When no comparison is active and the viewer can search, renders a
 *   "+ Compare" button that opens a debounced user-search dropdown. Selecting
 *   a user pushes `?vs=<github_username>` (preserving period/from/to).
 * - When a comparison is active, renders a chip with the compare user and an
 *   ✕ to clear it — shown to everyone so shared links can be dismissed.
 */
export function CompareControl({
  primaryUsername,
  currentVs,
  compareLabel,
  canSearch,
}: CompareControlProps) {
  const t = useTranslations("profile");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Build a href that sets or clears the `vs` param, keeping everything else.
  const buildHref = useMemo(() => {
    return (vsValue: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (vsValue) params.set("vs", vsValue);
      else params.delete("vs");
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    };
  }, [pathname, searchParams]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
  }, [open]);

  // Focus the input when the dropdown opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search against the (auth-gated) user-search API.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          // Only users with a github_username are addressable via ?vs=, and
          // never offer the profile owner as their own comparison.
          setResults(
            data.filter(
              (u) =>
                u.github_username &&
                u.github_username.toLowerCase() !== primaryUsername.toLowerCase()
            )
          );
        }
      } catch {
        // Silently ignore — the dropdown just shows no results.
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, primaryUsername]);

  function selectUser(username: string) {
    setOpen(false);
    setQuery("");
    router.push(buildHref(username));
  }

  // ── Active comparison: show a dismissible chip ──────────────────────────────
  if (currentVs) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 px-2.5 py-1.5">
        <span className="font-mono text-xs font-medium text-foreground">
          {t("comparingWith", { user: compareLabel ?? currentVs })}
        </span>
        <button
          type="button"
          onClick={() => router.push(buildHref(null))}
          aria-label={t("clearCompare")}
          className="flex h-4 w-4 items-center justify-center rounded text-foreground/60 transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // Viewers who can't search and aren't already comparing get no control.
  if (!canSearch) return null;

  // ── No comparison yet: "+ Compare" button + search dropdown ─────────────────
  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs font-medium text-foreground/80 transition-colors hover:bg-surface-hover hover:text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        {t("compare")}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("compareSearch")}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />

          {loading && (
            <p className="mt-2 px-1 font-mono text-[10px] text-muted">{t("compareSearching")}</p>
          )}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="mt-2 px-1 font-mono text-[10px] text-muted">{t("compareNoResults")}</p>
          )}

          {results.length > 0 && (
            <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto">
              {results.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => selectUser(user.github_username!)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  >
                    {user.image ? (
                      <Image
                        src={user.image}
                        alt=""
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-full ring-1 ring-border"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-surface ring-1 ring-border" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {user.github_username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
