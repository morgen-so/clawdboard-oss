export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { after } from "next/server";
import Image from "next/image";
import { cachedAuth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { UserNav } from "@/components/auth/UserNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Header } from "@/components/layout/Header";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { BadgesClient } from "@/components/settings/BadgesClient";
import { getUserDailyData, getUserRank } from "@/lib/db/cached";
import { computeFullBadgeState } from "@/lib/badges";
import { persistEarnedBadges } from "@/lib/db/profile";
import { rebuildLeaderboardSnapshot, runSnapshotJob } from "@/lib/snapshot/build";

export const metadata: Metadata = {
  title: "Settings — clawdboard",
  robots: { index: false, follow: false },
};

function timeAgo(date: Date, tAgo: (key: string, values?: Record<string, string | number>) => string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return tAgo("justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tAgo("minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tAgo("hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return tAgo("daysAgo", { count: days });
}

export default async function SettingsPage() {
  const session = await cachedAuth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const t = await getTranslations("settings");
  const tAgo = await getTranslations("timeAgo");

  // Fetch user settings and badge data in parallel
  const [userRows, allDailyData, rank] = await Promise.all([
    db
      .select({
        cookingUrl: users.cookingUrl,
        cookingLabel: users.cookingLabel,
        lastSyncAt: users.lastSyncAt,
        createdAt: users.createdAt,
        pinnedBadges: users.pinnedBadges,
        earnedBadges: users.earnedBadges,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
    getUserDailyData(session.user.id),
    getUserRank(session.user.id),
  ]);

  const [user] = userRows;

  const displayName =
    session.user.githubUsername ?? session.user.name ?? "user";

  const { badges, totalXp, xpProgress, allEarnedIds, newlyEarnedIds, isFirstComputation } =
    computeFullBadgeState(allDailyData, rank, (user?.earnedBadges ?? []) as string[]);

  // Persist newly earned badges after response (serverless-safe), and
  // refresh the snapshot's copy so profile views don't save them again.
  if (newlyEarnedIds.length > 0 && session.user.id) {
    after(async () => {
      await persistEarnedBadges(session.user.id!, allEarnedIds);
      await runSnapshotJob("badge save", rebuildLeaderboardSnapshot);
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        subtitle="settings"
        rightContent={
          <>
            <NotificationBell />
            <UserNav name={displayName} image={session.user.image} />
          </>
        }
      />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 space-y-6">
        {/* Profile */}
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="font-display text-sm font-bold text-foreground mb-4">
            <span className="font-mono text-accent mr-2">$</span>
            {t("profile")}
          </h2>
          <div className="flex items-center gap-4 mb-4">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={displayName}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full ring-1 ring-border"
              />
            )}
            <div>
              <p className="font-mono text-sm font-medium text-foreground">
                {session.user.name ?? displayName}
              </p>
              {session.user.githubUsername && (
                <p className="font-mono text-xs text-muted">
                  @{session.user.githubUsername}
                </p>
              )}
              {user?.createdAt && (
                <p className="font-mono text-[10px] text-dim">
                  {t("memberSince", {
                    date: user.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    }),
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 font-mono text-xs font-medium text-foreground">
              &#129489;&#8205;&#127859; {t("whatCooking")}
            </p>
            <SettingsClient
              username={displayName}
              cookingUrl={user?.cookingUrl ?? null}
              cookingLabel={user?.cookingLabel ?? null}
            />
          </div>
        </section>

        {/* Badges & Kitchen Rank */}
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="font-display text-sm font-bold text-foreground mb-4">
            <span className="font-mono text-accent mr-2">$</span>
            {t("badgesAndKitchenRank")}
          </h2>
          <BadgesClient
            badges={badges}
            totalXp={totalXp}
            xpProgress={xpProgress}
            pinnedBadgeIds={(user?.pinnedBadges as string[]) ?? []}
            username={displayName}
            isOwner={true}
            suppressModal={isFirstComputation}
          />
        </section>

        {/* Sync Status */}
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="font-display text-sm font-bold text-foreground mb-4">
            <span className="font-mono text-accent mr-2">$</span>
            {t("syncStatus")}
          </h2>
          {user?.lastSyncAt ? (
            <p className="font-mono text-xs text-muted">
              {t("lastSynced")}{" "}
              <span className="text-foreground">
                {timeAgo(user.lastSyncAt, tAgo)}
              </span>
            </p>
          ) : (
            <p className="font-mono text-xs text-muted">
              {t("neverSynced")}{" "}
{/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional: full page reload for dashboard */}
              <a
                href="/dashboard"
                className="text-accent hover:text-accent/80 transition-colors"
              >
                {t("setupSyncing")} &rarr;
              </a>
            </p>
          )}
          <div className="mt-3 rounded-md bg-background p-3">
            <p className="font-mono text-[10px] text-dim mb-1">
              {t("syncCommand")}
            </p>
            <code className="font-mono text-xs text-accent">
              npx clawdboard
            </code>
          </div>
        </section>
      </main>
    </div>
  );
}
