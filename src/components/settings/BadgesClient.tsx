"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { EarnedBadge, BadgeCategory, BadgeGroup } from "@/lib/badges";
import { MAX_PINNED_BADGES } from "@/lib/badges";
import type { XpProgress } from "@/lib/kitchen-rank";
import { KitchenRankIcon } from "@/components/icons/KitchenRankIcons";
import { updatePinnedBadges } from "@/actions/users";
import { BadgeUnlockModal } from "@/components/profile/BadgeUnlockModal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BadgesClientProps {
  badges: EarnedBadge[];
  totalXp: number;
  xpProgress: XpProgress;
  pinnedBadgeIds: string[];
  username: string;
  isOwner: boolean;
  suppressModal?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_KEYS: BadgeCategory[] = ["all-time", "daily", "monthly"];

// ─── Component ───────────────────────────────────────────────────────────────

export function BadgesClient({
  badges,
  totalXp,
  xpProgress,
  pinnedBadgeIds,
  username,
  isOwner,
  suppressModal = false,
}: BadgesClientProps) {
  const t = useTranslations("badges");
  const tSettings = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<BadgeCategory>("all-time");
  const [pinned, setPinned] = useState<Set<string>>(new Set(pinnedBadgeIds));
  const [isPending, startTransition] = useTransition();

  const earnedCount = badges.filter((b) => b.earned).length;
  const filteredBadges = badges.filter(
    (b) => b.definition.category === activeTab
  );

  const groupedBadges = useMemo(() => {
    const groups: { group: BadgeGroup; badges: EarnedBadge[] }[] = [];
    for (const badge of filteredBadges) {
      const last = groups[groups.length - 1];
      if (last && last.group === badge.definition.group) {
        last.badges.push(badge);
      } else {
        groups.push({ group: badge.definition.group, badges: [badge] });
      }
    }
    return groups;
  }, [filteredBadges]);

  function togglePin(badgeId: string) {
    const next = new Set(pinned);
    if (next.has(badgeId)) {
      next.delete(badgeId);
    } else {
      if (next.size >= MAX_PINNED_BADGES) return;
      next.add(badgeId);
    }
    setPinned(next);
    startTransition(async () => {
      await updatePinnedBadges([...next]);
    });
  }

  return (
    <>
      {/* Unlock modal (owner only, fires once for new badges) */}
      {isOwner && (
        <BadgeUnlockModal
          username={username}
          badges={badges}
          totalXp={totalXp}
          xpProgress={xpProgress}
          suppressModal={suppressModal}
        />
      )}

      {/* Kitchen Rank Progress */}
      <div className="mb-5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="group relative flex items-center gap-2 cursor-default">
            <span className={xpProgress.current.color}>
              <KitchenRankIcon tier={xpProgress.current.tier} className="h-5 w-5" />
            </span>
            <span className={`font-mono text-sm font-bold ${xpProgress.current.color}`}>
              {xpProgress.current.title}
            </span>
            <div className="pointer-events-none absolute left-0 top-full mt-1.5 z-10 whitespace-nowrap rounded border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] text-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {xpProgress.next
                ? t("keepCooking", { title: xpProgress.next.title })
                : t("highestRank")}
            </div>
          </div>
          <span className="font-mono text-xs text-muted ml-auto">
            {t("badgeCount", { earned: earnedCount, total: badges.length })}
          </span>
        </div>

        {/* XP progress bar */}
        <div className="relative h-2 rounded-full bg-background overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-500"
            style={{ width: `${xpProgress.percent}%` }}
          />
        </div>

        <div className="flex items-center justify-between font-mono text-[10px] text-dim">
          <span>{t("totalXp", { count: totalXp })}</span>
          {xpProgress.next ? (
            <span>
              {t("nextRank", { title: xpProgress.next.title, xp: xpProgress.next.minXp - totalXp })}
            </span>
          ) : (
            <span>{t("maxRank")}</span>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 font-mono text-xs transition-colors -mb-px ${
              activeTab === key
                ? "text-accent border-b-2 border-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(key === "all-time" ? "allTime" : key)}
          </button>
        ))}
      </div>

      {/* Pin count (owner only) */}
      {isOwner && (
        <p className="font-mono text-[10px] text-dim mb-3">
          {tSettings("pinnedToProfile", { count: pinned.size, max: MAX_PINNED_BADGES })}
          {isPending && ` — ${tSettings("savingPins")}`}
        </p>
      )}

      {/* Badge grid — grouped by badge group */}
      <div className="space-y-5">
        {groupedBadges.map(({ group, badges: groupBadges }) => (
            <div key={group}>
              <p className="font-mono text-[10px] text-dim uppercase tracking-wider mb-2">
                {t(`groups.${group}`)}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {groupBadges.map((badge) => {
                  const { definition, earned } = badge;
                  const isPinned = pinned.has(definition.id);

                  return (
                    <div
                      key={definition.id}
                      className={`relative rounded-lg border p-3 text-left transition-all ${
                        earned
                          ? "border-accent/30 bg-accent/5 shadow-[0_0_8px_rgba(249,166,21,0.08)]"
                          : "border-border bg-surface opacity-40"
                      }`}
                    >
                      <p
                        className={`font-mono text-xs font-medium ${
                          earned ? "text-foreground" : "text-muted"
                        }`}
                      >
                        {definition.label}
                      </p>
                      <p className="font-mono text-[10px] text-dim mt-0.5 leading-tight">
                        {definition.description}
                      </p>
                      {earned && (
                        <span className="font-mono text-[10px] text-accent mt-1 block">
                          +{definition.xp} {t("xp")}
                        </span>
                      )}

                      {/* Pin toggle (owner + earned only) */}
                      {isOwner && earned && (
                        <button
                          onClick={() => togglePin(definition.id)}
                          disabled={isPending || (!isPinned && pinned.size >= MAX_PINNED_BADGES)}
                          className={`mt-2 font-mono text-[10px] transition-colors ${
                            isPinned
                              ? "text-accent hover:text-accent/70"
                              : "text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                          }`}
                        >
                          {isPinned ? `★ ${t("unpin")}` : `☆ ${t("pin")}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
