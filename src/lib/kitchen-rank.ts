// ─── Kitchen Rank System ─────────────────────────────────────────────────────
// XP from earned badges determines rank tier. Cuisine-themed progression
// from Dishwasher to Master Chef.

export type KitchenRank = {
  tier: number;
  title: string;
  minXp: number;
  color: string; // tailwind class
};

export type XpProgress = {
  current: KitchenRank;
  next: KitchenRank | null;
  xpInTier: number;
  xpNeeded: number;
  percent: number;
};

const KITCHEN_RANKS: KitchenRank[] = [
  { tier: 1, title: "Dishwasher", minXp: 0, color: "text-muted" },
  { tier: 2, title: "Prep Cook", minXp: 20, color: "text-zinc-400" },
  { tier: 3, title: "Line Cook", minXp: 60, color: "text-amber-400" },
  { tier: 4, title: "Sous Chef", minXp: 120, color: "text-orange-400" },
  { tier: 5, title: "Head Chef", minXp: 200, color: "text-red-400" },
  { tier: 6, title: "Executive Chef", minXp: 300, color: "text-purple-400" },
  { tier: 7, title: "Master Chef", minXp: 420, color: "text-yellow-300" },
];

/**
 * Get the kitchen rank for a given total XP.
 */
export function getKitchenRank(totalXp: number): KitchenRank {
  let rank = KITCHEN_RANKS[0];
  for (const r of KITCHEN_RANKS) {
    if (totalXp >= r.minXp) rank = r;
  }
  return rank;
}

/**
 * Get XP progress within the current rank tier.
 */
export function getXpProgress(totalXp: number): XpProgress {
  const current = getKitchenRank(totalXp);
  const nextIndex = KITCHEN_RANKS.findIndex((r) => r.tier === current.tier) + 1;
  const next = nextIndex < KITCHEN_RANKS.length ? KITCHEN_RANKS[nextIndex] : null;

  if (!next) {
    return { current, next: null, xpInTier: 0, xpNeeded: 0, percent: 100 };
  }

  const xpInTier = totalXp - current.minXp;
  const xpNeeded = next.minXp - current.minXp;
  const percent = Math.min(100, Math.round((xpInTier / xpNeeded) * 100));

  return { current, next, xpInTier, xpNeeded, percent };
}
