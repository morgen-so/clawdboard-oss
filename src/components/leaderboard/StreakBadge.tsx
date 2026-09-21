// src/components/leaderboard/StreakBadge.tsx

import { useTranslations } from "next-intl";
import { getStreakTier } from "@/lib/streak-tiers";

interface StreakBadgeProps {
  count: number;
  /** Free passes banked and unspent. */
  passes?: number;
  /** Days a pass is currently holding the streak open. 0 when not frozen. */
  frozenFor?: number;
}

export function StreakBadge({
  count,
  passes = 0,
  frozenFor = 0,
}: StreakBadgeProps) {
  const t = useTranslations("leaderboard");
  const tier = getStreakTier(count);

  const title = [
    t("streakTitle", { count, tier: tier.name }),
    frozenFor > 0 && t("streakFrozenTitle", { days: frozenFor }),
    passes > 0 && t("streakPassesTitle", { count: passes }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-sm ${tier.textGlow}`}
      title={title}
    >
      {tier.icon && <span className="text-xs">{tier.icon}</span>}
      <span className={`font-semibold tabular-nums ${tier.textColor}`}>
        {count}
      </span>
      {frozenFor > 0 && (
        <span className="text-[10px] text-sky-400" aria-hidden="true">
          &#10052;&#65039;
        </span>
      )}
      {tier.tier >= 2 && (
        <span
          className={`text-[10px] font-medium ${tier.textColor} opacity-70 hidden sm:inline`}
        >
          {tier.name}
        </span>
      )}
      {passes > 0 && (
        <span
          className="text-[10px] text-muted opacity-80 hidden sm:inline tabular-nums"
          aria-hidden="true"
        >
          &#127903;{passes > 1 ? passes : ""}
        </span>
      )}
    </span>
  );
}
