// ─── Kitchen Rank Icons ──────────────────────────────────────────────────────
// Inline SVG icons for each rank tier. Monoline stroke style, 24x24 viewBox,
// uses currentColor so they inherit the rank's color class.

const svgProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Tier 1 — Dishwasher: plate/dish */
function DishwasherIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <ellipse cx="12" cy="14" rx="9" ry="5" />
      <ellipse cx="12" cy="14" rx="5" ry="2.5" />
      <path d="M6 9c0-2.5 2.7-4.5 6-4.5s6 2 6 4.5" />
    </svg>
  );
}

/** Tier 2 — Prep Cook: knife */
function PrepCookIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M15.5 3L7 11.5l1.5 1.5 8.5-8.5" />
      <path d="M7 11.5l-3.5 3.5 1.5 1.5L8.5 13" />
      <path d="M4 20l2-2" />
      <path d="M18 6c1-1 2.5-.5 2.5-.5s.5 1.5-.5 2.5L15.5 3" />
    </svg>
  );
}

/** Tier 3 — Line Cook: frying pan */
function LineCookIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx="10" cy="12" r="7" />
      <path d="M16 8l5-5" />
      <ellipse cx="10" cy="12" rx="4.5" ry="4" />
    </svg>
  );
}

/** Tier 4 — Sous Chef: chef hat */
function SousChefIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M6 15v4h12v-4" />
      <path d="M6 15c-2 0-3.5-1.5-3.5-3.5S5 7 6 6c.5-2 2.5-3 4-3 1 0 1.5.5 2 1 .5-.5 1-1 2-1 1.5 0 3.5 1 4 3 1 1 3.5 2 3.5 4.5S20 15 18 15" />
    </svg>
  );
}

/** Tier 5 — Head Chef: flame */
function HeadChefIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 22c-4 0-6-3-6-6 0-4 4-6 4-10 0 0 2 2 2 5 1-2 2-4 2-6 4 3 6 5 6 8 0 6-4 9-8 9z" />
      <path d="M12 22c-2 0-3-1.5-3-3 0-2 2-3 2-5 0 0 1 1 1 2.5.5-1 1-2 1-3 2 1.5 3 2.5 3 4 0 3-2 4.5-4 4.5z" />
    </svg>
  );
}

/** Tier 6 — Executive Chef: diamond */
function ExecutiveChefIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 2l4 6-4 12-4-12 4-6z" />
      <path d="M2 8l10 12L22 8" />
      <path d="M2 8l4-6h12l4 6" />
      <path d="M2 8h20" />
    </svg>
  );
}

/** Tier 7 — Master Chef: crown */
function MasterChefIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M2 18h20v2H2z" />
      <path d="M4 18l-2-10 5 4 5-8 5 8 5-4-2 10" />
      <circle cx="2" cy="8" r="1" fill="currentColor" />
      <circle cx="22" cy="8" r="1" fill="currentColor" />
      <circle cx="12" cy="4" r="1" fill="currentColor" />
    </svg>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

const RANK_ICONS = [
  DishwasherIcon,
  PrepCookIcon,
  LineCookIcon,
  SousChefIcon,
  HeadChefIcon,
  ExecutiveChefIcon,
  MasterChefIcon,
];

export function KitchenRankIcon({
  tier,
  className,
}: {
  tier: number;
  className?: string;
}) {
  const Icon = RANK_ICONS[tier - 1] ?? DishwasherIcon;
  return <Icon className={className} />;
}
