"use client";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { type LeaderboardRow } from "@/lib/db/leaderboard";
import { StreakBadge } from "@/components/leaderboard/StreakBadge";
import { formatMonthYear } from "@/lib/format";

interface MemberData {
  userId: string;
  githubUsername: string | null;
  image: string | null;
  role: string;
  joinedAt: Date | null;
  leftAt: Date | null;
}

interface MemberListProps {
  members: MemberData[];
  memberStats: LeaderboardRow[];
}

export function MemberList({ members, memberStats }: MemberListProps) {
  const active = members.filter((m) => m.leftAt === null);
  const past = members.filter((m) => m.leftAt !== null);
  const t = useTranslations("team");

  // Build a lookup map from userId to stats
  const statsMap = new Map(memberStats.map((s) => [s.userId, s]));

  return (
    <div className="space-y-6">
      {/* Active members */}
      <section>
        <h2 className="mb-4 font-display text-sm font-bold text-foreground">
          {t("membersCount", { count: active.length })}
        </h2>
        <div className="grid gap-3">
          {active.map((member) => {
            const initials = member.githubUsername
              ? member.githubUsername.slice(0, 2).toUpperCase()
              : "??";
            const stats = statsMap.get(member.userId);

            return (
              <div
                key={member.userId}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-center gap-3">
                  {member.image ? (
                    <Image
                      src={member.image}
                      alt=""
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-full ring-1 ring-border flex-shrink-0"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-border text-[11px] font-medium text-muted ring-1 ring-border flex-shrink-0">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {member.githubUsername ? (
                        <Link
                          href={`/user/${member.githubUsername}`}
                          className="truncate font-mono text-sm font-medium text-foreground transition-colors hover:text-accent"
                        >
                          {member.githubUsername}
                        </Link>
                      ) : (
                        <span className="truncate font-mono text-sm text-foreground/60">
                          Anonymous
                        </span>
                      )}
                      {member.role === "owner" && (
                        <span className="flex-shrink-0 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
                          {t("owner")}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted">
                      {t("memberSince", { date: formatMonthYear(member.joinedAt) })}
                    </p>
                  </div>
                </div>

                {/* Member stats */}
                {stats && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded bg-background px-3 py-2">
                      <p className="text-[10px] font-medium text-muted">{t("cost")}</p>
                      <p className="font-mono text-sm font-semibold text-accent">
                        <span className="text-muted">$</span>
                        {Number(stats.totalCost).toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded bg-background px-3 py-2">
                      <p className="text-[10px] font-medium text-muted">{t("tokens")}</p>
                      <p className="font-mono text-sm font-semibold text-foreground">
                        {Number(stats.totalTokens).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded bg-background px-3 py-2">
                      <p className="text-[10px] font-medium text-muted">{t("activeDays")}</p>
                      <p className="font-mono text-sm font-semibold text-foreground">
                        {stats.activeDays}
                      </p>
                    </div>
                    <div className="rounded bg-background px-3 py-2">
                      <p className="text-[10px] font-medium text-muted">{t("streak")}</p>
                      <p className="font-mono text-sm font-semibold">
                        {stats.currentStreak > 0 ? (
                          <StreakBadge count={stats.currentStreak} />
                        ) : (
                          <span className="text-dim">&mdash;</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Past contributors */}
      {past.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-sm font-bold text-muted">
            {t("formerContributors", { count: past.length })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {past.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-surface/50 p-3"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-border/60 text-[11px] font-medium text-dim flex-shrink-0">
                  FC
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-muted">
                    {t("formerContributor")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
