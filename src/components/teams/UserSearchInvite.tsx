"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface SearchResult {
  id: string;
  github_username: string | null;
  name: string | null;
  image: string | null;
}

interface UserSearchInviteProps {
  teamId: string;
}

export function UserSearchInvite({ teamId }: UserSearchInviteProps) {
  const t = useTranslations("team");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query.trim())}&excludeTeam=${teamId}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, teamId]);

  const handleInvite = async (userId: string) => {
    setInvitingId(userId);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("teamId", teamId);
      formData.set("targetUserId", userId);
      const { inviteToTeam } = await import("@/actions/teams");
      const result = await inviteToTeam(undefined, formData);
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setInvitedIds((prev) => new Set(prev).add(userId));
      }
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchUsersLabel")}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="h-3 w-3 animate-spin rounded-full border border-muted border-t-accent" />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 font-mono text-[10px] text-red-400">{error}</p>
      )}

      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="mt-2 font-mono text-[10px] text-muted">
          {t("minChars")}
        </p>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-2 font-mono text-[10px] text-muted">
          {t("noResults")}
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((user) => {
            const isInvited = invitedIds.has(user.id);
            const isInviting = invitingId === user.id;
            return (
              <li
                key={user.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
              >
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.github_username ?? user.name ?? ""}
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded-full ring-1 ring-border"
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-surface ring-1 ring-border" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-foreground">
                    {user.github_username ?? user.name ?? "—"}
                  </span>
                  {user.github_username && user.name && (
                    <span className="ml-1.5 font-mono text-[10px] text-muted">
                      {user.name}
                    </span>
                  )}
                </div>
                {isInvited ? (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-success">
                    <svg
                      width="12"
                      height="12"
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
                    {t("invited")}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isInviting}
                    onClick={() => handleInvite(user.id)}
                    className="rounded-md border border-accent/40 px-2 py-0.5 font-mono text-[10px] font-medium text-accent transition-all hover:bg-accent/10 hover:border-accent disabled:opacity-50 cursor-pointer"
                  >
                    {isInviting ? "..." : t("inviteAction")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
