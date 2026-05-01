"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { type LeaderboardRow } from "@/lib/db/leaderboard";
import { SortHeader } from "./SortHeader";
import { StreakBadge } from "./StreakBadge";
import { RankMovement } from "./RankMovement";
import { StreakAura } from "@/components/ui/StreakAura";
import { buildProfileHref, safeHostname } from "@/lib/url";
import { loadMoreRows } from "@/actions/leaderboard";
import { rankColors, rankIcons, rankBorderClass } from "@/lib/rank";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  sort: string;
  order: string;
  currentUserId?: string;
  totalCount?: number;
  period?: string;
  rangeFrom?: string;
  rangeTo?: string;
}

export function LeaderboardTable({
  rows: initialRows,
  sort,
  order,
  currentUserId,
  totalCount,
  period,
  rangeFrom,
  rangeTo,
}: LeaderboardTableProps) {
  const t = useTranslations("leaderboard");
  const [rows, setRows] = useState(initialRows);
  const [isPending, startTransition] = useTransition();

  const resolvedTotal = totalCount ?? rows.length;
  const hasMore = rows.length < resolvedTotal;

  function handleLoadMore() {
    startTransition(async () => {
      const result = await loadMoreRows(period ?? "7d", sort, order, rows.length, 100, rangeFrom, rangeTo);
      setRows(prev => [...prev, ...result.rows]);
    });
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-widest text-muted">
              <th className="px-3 py-3 w-10 sm:px-4 sm:w-12">#</th>
              <th className="hidden sm:table-cell px-2 py-3 w-10"></th>
              <th className="px-3 py-3 sm:px-4">{t("user")}</th>
              <SortHeader
                label={t("cost")}
                column="cost"
                currentSort={sort}
                currentOrder={order}
                className="px-3 py-3 text-right sm:px-4"
              />
              <SortHeader
                label={t("tokens")}
                column="tokens"
                currentSort={sort}
                currentOrder={order}
                className="hidden sm:table-cell px-4 py-3 text-right"
              />
              <SortHeader
                label={t("activeDays")}
                column="days"
                currentSort={sort}
                currentOrder={order}
                className="hidden sm:table-cell px-4 py-3 text-right"
              />
              <SortHeader
                label={t("streak")}
                column="streak"
                currentSort={sort}
                currentOrder={order}
                className="px-3 py-3 text-right sm:px-4"
                tooltip={t("streakTooltip")}
              />
              <th className="hidden md:table-cell px-4 py-3 text-left">
                <span className="inline-flex items-center gap-1">
                  &#129489;&#8205;&#127859; {t("cooking")}
                  <InfoTooltip text={t("cookingTooltip")} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-16 text-center sm:px-4"
                >
                  <div className="flex flex-col items-center gap-2 text-muted">
                    <span className="text-2xl opacity-40">&gt;_</span>
                    <span className="text-sm">{t("noDataYet")}</span>
                    <span className="text-xs text-dim">
                      {t.rich("getStarted", {
                        command: (chunks) => <code className="text-accent/80">{chunks}</code>
                      })}
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <LeaderboardRowItem
                  key={row.userId}
                  row={row}
                  index={index}
                  isCurrentUser={row.userId === currentUserId}
                  period={period}
                  rangeFrom={rangeFrom}
                  rangeTo={rangeTo}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more + counter */}
      {hasMore && (
        <div className="mt-3 flex items-center justify-between font-mono text-xs text-muted">
          <span>
            {t("showingCount", { shown: rows.length, total: resolvedTotal })}
          </span>
          <button
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            {isPending ? t("loading") : t("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

export function LeaderboardRowItem({
  row,
  index,
  isCurrentUser,
  period,
  rangeFrom,
  rangeTo,
}: {
  row: LeaderboardRow;
  index: number;
  isCurrentUser?: boolean;
  period?: string;
  rangeFrom?: string;
  rangeTo?: string;
}) {
  const t = useTranslations("leaderboard");
  const initials = row.githubUsername
    ? row.githubUsername.slice(0, 2).toUpperCase()
    : "??";

  const isTop3 = row.rank <= 3;

  return (
    <tr
      className={`group row-stagger transition-colors hover:bg-surface-hover ${isCurrentUser ? "bg-accent/5" : ""} ${row.rank === 1 ? "bg-amber-400/[0.04]" : ""}`}
      style={{ "--row-index": index } as React.CSSProperties}
    >
      {/* Rank */}
      <td className={`px-3 py-3 sm:px-4 font-semibold ${isTop3 ? rankColors[row.rank] : "text-dim"} ${rankBorderClass(row.rank)}`}>
        {isTop3 ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-xs">{rankIcons[row.rank]}</span>
            {row.rank}
          </span>
        ) : (
          row.rank
        )}
      </td>

      {/* Movement */}
      <td className="hidden sm:table-cell px-2 py-3 text-center">
        <RankMovement delta={row.rankDelta} isNew={row.isNew} />
      </td>

      {/* User */}
      <td className="px-3 py-3 sm:px-4">
        {row.githubUsername ? (
          <Link href={buildProfileHref(row.githubUsername, period, rangeFrom, rangeTo)} className="block">
            <div className="flex items-center gap-3">
              <StreakAura streak={row.currentStreak} size="sm">
                {row.image ? (
                  <Image
                    src={row.image}
                    alt={row.githubUsername}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full flex-shrink-0"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-muted">
                    {initials}
                  </div>
                )}
              </StreakAura>
              <span className={`truncate max-w-[120px] sm:max-w-none font-medium transition-colors hover:text-blue-600 group-hover:text-accent ${isTop3 ? "text-foreground" : "text-foreground/80"}`}>
                {row.githubUsername}
              </span>
              {isCurrentUser && (
                <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                  {t("you")}
                </span>
              )}
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <StreakAura streak={row.currentStreak} size="sm">
              <div className="h-7 w-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-muted">
                {initials}
              </div>
            </StreakAura>
            <span className="truncate max-w-[120px] sm:max-w-none font-medium text-foreground/60">
              {t("anonymous")}
            </span>
          </div>
        )}
      </td>

      {/* Cost */}
      <td className="px-3 py-3 sm:px-4 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
        <span className="text-muted">$</span>{Number(row.totalCost).toFixed(2)}
      </td>

      {/* Tokens */}
      <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
        {Number(row.totalTokens).toLocaleString()}
      </td>

      {/* Days */}
      <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums text-foreground/70 transition-colors group-hover:text-foreground">
        {row.activeDays}
      </td>

      {/* Streak */}
      <td className="px-3 py-3 sm:px-4 text-right">
        {row.currentStreak > 0 ? (
          <StreakBadge count={row.currentStreak} />
        ) : (
          <span className="text-dim">&mdash;</span>
        )}
      </td>

      {/* Cooking */}
      <td className="hidden md:table-cell px-4 py-3 text-left">
        {row.cookingUrl ? (
          <a
            href={row.cookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent transition-colors hover:text-accent/80 truncate max-w-[140px] block"
          >
            {row.cookingLabel || safeHostname(row.cookingUrl)}
          </a>
        ) : (
          <span className="text-dim">&mdash;</span>
        )}
      </td>
    </tr>
  );
}
