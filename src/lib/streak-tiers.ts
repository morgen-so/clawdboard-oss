// ─── Streak Tier System ─────────────────────────────────────────────────────
// Single source of truth for the 7-tier "Streak Aura" system.
// Every component that renders streak visuals imports from here.

export type StreakTier = {
  tier: number;
  name: string;
  minDays: number;
  icon: string;
  /** Tailwind classes for the gradient ring wrapper */
  ringClass: string;
  /** Box-shadow glow for the ring wrapper */
  glowClass: string;
  /** CSS animation class(es) for the ring */
  animationClass: string;
  /** Whether the ring animation includes rotation (for counter-rotation of children) */
  spins: boolean;
  /** Tailwind text color class for streak badges/labels */
  textColor: string;
  /** Drop-shadow class for text glow on badges */
  textGlow: string;
  /** Hardcoded hex for OG images (Satori can't use CSS vars/animations) */
  staticRingColor: string;
  /** Celebration modal config — null means no confetti (subtle modal only) */
  celebration: {
    confettiColors: string[];
    particleCount: number;
    secondBurstCount: number;
    spread: number;
    modalBorder: string;
    modalGlow: string;
  } | null;
};

const TIERS: StreakTier[] = [
  {
    tier: 0,
    name: "none",
    minDays: 0,
    icon: "",
    ringClass: "",
    glowClass: "",
    animationClass: "",
    spins: false,
    textColor: "text-muted",
    textGlow: "",
    staticRingColor: "#23232a",
    celebration: null,
  },
  {
    tier: 1,
    name: "Spark",
    minDays: 2,
    icon: "\u00B7",
    ringClass: "bg-amber-600/80",
    glowClass: "",
    animationClass: "",
    spins: false,
    textColor: "text-muted",
    textGlow: "",
    staticRingColor: "#d97706",
    celebration: null,
  },
  {
    tier: 2,
    name: "Flame",
    minDays: 7,
    icon: "\uD83D\uDD25",
    ringClass: "bg-amber-500",
    glowClass: "shadow-[0_0_8px_rgba(245,158,11,0.4)]",
    animationClass: "animate-streak-pulse",
    spins: false,
    textColor: "text-amber-400",
    textGlow: "",
    staticRingColor: "#f59e0b",
    celebration: {
      confettiColors: ["#f59e0b", "#fbbf24", "#fcd34d", "#fafafa"],
      particleCount: 40,
      secondBurstCount: 20,
      spread: 60,
      modalBorder: "border-amber-500/40",
      modalGlow: "shadow-[0_0_30px_rgba(245,158,11,0.3)]",
    },
  },
  {
    tier: 3,
    name: "Fire",
    minDays: 14,
    icon: "\uD83D\uDD25",
    ringClass: "bg-orange-500",
    glowClass: "shadow-[0_0_12px_rgba(249,115,22,0.5)]",
    animationClass: "animate-streak-breathe",
    spins: false,
    textColor: "text-orange-400",
    textGlow: "drop-shadow-[0_0_6px_rgba(249,115,22,0.4)]",
    staticRingColor: "#f97316",
    celebration: {
      confettiColors: ["#f97316", "#fb923c", "#fdba74", "#F9A615"],
      particleCount: 60,
      secondBurstCount: 30,
      spread: 80,
      modalBorder: "border-orange-500/40",
      modalGlow: "shadow-[0_0_30px_rgba(249,115,22,0.35)]",
    },
  },
  {
    tier: 4,
    name: "Blaze",
    minDays: 30,
    icon: "\uD83D\uDD25",
    ringClass: "bg-gradient-to-r from-orange-500 to-red-500",
    glowClass: "shadow-[0_0_16px_rgba(239,68,68,0.5)]",
    animationClass: "animate-streak-breathe",
    spins: false,
    textColor: "text-red-400",
    textGlow: "drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]",
    staticRingColor: "#ef4444",
    celebration: {
      confettiColors: ["#ef4444", "#f97316", "#dc2626", "#fbbf24", "#fafafa"],
      particleCount: 80,
      secondBurstCount: 40,
      spread: 100,
      modalBorder: "border-red-500/40",
      modalGlow: "shadow-[0_0_35px_rgba(239,68,68,0.35)]",
    },
  },
  {
    tier: 5,
    name: "Inferno",
    minDays: 60,
    icon: "\uD83D\uDD25",
    ringClass: "bg-gradient-to-r from-red-500 to-purple-500",
    glowClass: "shadow-[0_0_20px_rgba(168,85,247,0.5)]",
    animationClass: "animate-streak-spin",
    spins: true,
    textColor: "text-purple-400",
    textGlow: "drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]",
    staticRingColor: "#a855f7",
    celebration: {
      confettiColors: ["#a855f7", "#ef4444", "#c084fc", "#e879f9", "#fafafa"],
      particleCount: 100,
      secondBurstCount: 50,
      spread: 110,
      modalBorder: "border-purple-500/40",
      modalGlow: "shadow-[0_0_40px_rgba(168,85,247,0.4)]",
    },
  },
  {
    tier: 6,
    name: "Eternal",
    minDays: 100,
    icon: "\u2726",
    ringClass: "bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500",
    glowClass: "shadow-[0_0_24px_rgba(250,204,21,0.6)]",
    animationClass: "animate-streak-spin animate-streak-shimmer",
    spins: true,
    textColor: "text-yellow-300",
    textGlow: "drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]",
    staticRingColor: "#facc15",
    celebration: {
      confettiColors: ["#facc15", "#fde047", "#fbbf24", "#F9A615", "#fafafa", "#a855f7"],
      particleCount: 120,
      secondBurstCount: 60,
      spread: 120,
      modalBorder: "border-yellow-400/50",
      modalGlow: "shadow-[0_0_50px_rgba(250,204,21,0.4)]",
    },
  },
  {
    tier: 7,
    name: "Transcendent",
    minDays: 200,
    icon: "🦀",
    ringClass:
      "bg-[conic-gradient(from_0deg,#F9A615,#f43f5e,#a855f7,#22d3ee,#facc15,#F9A615)]",
    glowClass: "shadow-[0_0_32px_rgba(249,166,21,0.65)]",
    animationClass: "animate-streak-spin animate-streak-shimmer",
    spins: true,
    textColor: "text-accent-bright",
    textGlow: "drop-shadow-[0_0_12px_rgba(249,166,21,0.6)]",
    staticRingColor: "#F9A615",
    celebration: {
      confettiColors: ["#F9A615", "#FBC15B", "#facc15", "#f43f5e", "#fafafa"],
      particleCount: 150,
      secondBurstCount: 75,
      spread: 130,
      modalBorder: "border-accent/50",
      modalGlow: "shadow-[0_0_60px_rgba(249,166,21,0.45)]",
    },
  },
];

/** Tier number of the top "Transcendent" tier — owned by the Carcinization Event. */
export const TRANSCENDENT_TIER = 7;
/** Streak days required to reach the Transcendent tier. */
export const TRANSCENDENT_MIN_DAYS = 200;

/** Returns the matching streak tier for a given day count. */
export function getStreakTier(days: number): StreakTier {
  // Walk backwards through tiers to find the highest matching one
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (days >= TIERS[i].minDays) return TIERS[i];
  }
  return TIERS[0];
}
