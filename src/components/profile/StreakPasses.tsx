import { getTranslations } from "next-intl/server";
import { DAYS_PER_PASS, type StreakState } from "@/lib/streak";
import { getStreakTier } from "@/lib/streak-tiers";

interface StreakPassesProps {
  streak: StreakState;
}

/** How many pass slots to draw before falling back to a plain count. */
const MAX_TOKENS = 6;

/**
 * Free passes: the streak's insurance policy. Shows what's banked, how far
 * off the next one is, and — when a pass is what's keeping the streak
 * standing — says so plainly instead of letting the number look untroubled.
 *
 * Owner-only. A visitor sees the streak number and nothing about the passes
 * behind it, so the profile page renders this for the owner alone.
 */
export async function StreakPasses({ streak }: StreakPassesProps) {
  const t = await getTranslations("profile");
  if (streak.current === 0) return null;

  const tier = getStreakTier(streak.current);
  const { passesLeft, daysToNextPass, frozen, frozenFor } = streak;
  const earnedInto = DAYS_PER_PASS - (daysToNextPass ?? DAYS_PER_PASS);
  const progress = Math.round((earnedInto / DAYS_PER_PASS) * 100);

  return (
    <div
      className={`rounded-lg border bg-surface p-6 ${
        frozen ? "border-sky-500/40" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-semibold text-foreground">
          {t("passes")}
        </h3>
        <p className="font-mono text-sm text-muted">
          {t("passesEarnedTotal", { count: streak.passesEarned })}
          {streak.passesSpent > 0 &&
            ` · ${t("passesSpentTotal", { count: streak.passesSpent })}`}
        </p>
      </div>

      {/* Banked passes */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {passesLeft > MAX_TOKENS ? (
            <span className="text-2xl">&#127903;</span>
          ) : (
            Array.from({ length: Math.max(passesLeft, 1) }, (_, i) => (
              <span
                key={i}
                className={`text-2xl ${
                  i < passesLeft ? "" : "opacity-40 grayscale"
                }`}
              >
                &#127903;
              </span>
            ))
          )}
        </div>
        <p className="font-mono text-lg font-semibold text-foreground">
          {passesLeft > MAX_TOKENS && (
            <span className="mr-1">&#215;{passesLeft}</span>
          )}
          {t("passesBanked", { count: passesLeft })}
        </p>
      </div>

      {/* Progress to the next pass */}
      {daysToNextPass !== null && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className={`h-full rounded-full ${tier.tier >= 2 ? "bg-accent" : "bg-border-bright"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t("nextPassIn", { days: daysToNextPass })}
          </p>
        </div>
      )}

      {/* What the passes are doing right now */}
      <p className="mt-4 text-sm text-muted">
        {frozen ? (
          <span className="text-sky-400">
            &#10052;&#65039; {t("frozenNow", { days: frozenFor })}{" "}
            {t("frozenHint")}
          </span>
        ) : (
          t("passesExplainer", { days: DAYS_PER_PASS })
        )}
      </p>
    </div>
  );
}
