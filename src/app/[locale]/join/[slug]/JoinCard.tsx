"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { joinTeam } from "@/actions/teams";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { safeHostname } from "@/lib/url";
import { formatCostNumber } from "@/lib/format";

export type JoinState = "locked" | "locked-unauthenticated" | "already-member" | "unauthenticated" | "ready";

interface Member {
  userId: string;
  githubUsername: string | null;
  image: string | null;
}

interface JoinCardProps {
  team: {
    id: string;
    name: string;
    slug: string;
    cookingUrl: string | null;
    cookingLabel: string | null;
  };
  token: string;
  members: Member[];
  memberCount: number;
  stats: { totalCost: string; activeDays: number };
  state: JoinState;
  signInSlot: React.ReactNode;
}

function usernameList(members: Member[], total: number): string {
  const names = members
    .map((m) => m.githubUsername)
    .filter(Boolean) as string[];
  if (names.length === 0) return "";
  const overflow = total - names.length;
  if (overflow <= 0) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.join(", ")} and ${overflow} other${overflow === 1 ? "" : "s"}`;
}

export function JoinCard({
  team,
  token,
  members,
  memberCount,
  stats,
  state,
  signInSlot,
}: JoinCardProps) {
  const [actionState, formAction] = useActionState(joinTeam, undefined);
  const locale = useLocale();

  return (
    <div className="w-full rounded-lg border border-border bg-surface p-8 text-center">
      {/* Team name */}
      <h1 className="font-display text-xl font-bold text-foreground">
        {team.name}
      </h1>

      {/* Cooking link */}
      {team.cookingUrl && (
        <a
          href={team.cookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block font-mono text-xs text-muted transition-colors hover:text-accent"
        >
          &#129489;&#8205;&#127859; {team.cookingLabel || safeHostname(team.cookingUrl)}
        </a>
      )}

      {/* Avatar cluster */}
      {members.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-center -space-x-3">
            {members.map((m) => {
              const initials = m.githubUsername
                ? m.githubUsername.slice(0, 2).toUpperCase()
                : "??";
              return m.image ? (
                <Image
                  key={m.userId}
                  src={m.image}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full ring-2 ring-surface"
                />
              ) : (
                <div
                  key={m.userId}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-border text-[11px] font-medium text-muted ring-2 ring-surface"
                >
                  {initials}
                </div>
              );
            })}
            {memberCount > members.length && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-border font-mono text-[11px] font-medium text-muted ring-2 ring-surface">
                +{memberCount - members.length}
              </div>
            )}
          </div>
          <p className="mt-2 font-mono text-xs text-muted">
            {usernameList(members, memberCount)}
          </p>
        </div>
      )}

      {/* Stats row */}
      <p className="mt-4 font-mono text-xs text-muted">
        {memberCount} member{memberCount !== 1 ? "s" : ""} · $
        {formatCostNumber(stats.totalCost, locale)} spent · {stats.activeDays} active
        day{stats.activeDays !== 1 ? "s" : ""}
      </p>

      {/* CTA zone */}
      <div className="mt-6">
        {state === "ready" && (
          <form action={formAction}>
            <input type="hidden" name="teamId" value={team.id} />
            <input type="hidden" name="token" value={token} />
            {actionState?.error && (
              <p className="mb-3 font-mono text-xs text-red-400">
                {actionState.error}
              </p>
            )}
            <SubmitButton
              pendingText="Joining..."
              className="w-full rounded-md border border-accent bg-accent/10 px-4 py-2.5 font-mono text-sm font-medium text-accent transition-all hover:bg-accent/20 hover:shadow-[0_0_12px_rgba(249,166,21,0.15)]"
            >
              Join {team.name}
            </SubmitButton>
          </form>
        )}

        {state === "unauthenticated" && (
          <div>
            <p className="mb-4 font-mono text-sm text-muted">
              Sign in with GitHub to join this team.
            </p>
            {signInSlot}
          </div>
        )}

        {state === "already-member" && (
          <div>
            <p className="mb-4 font-mono text-sm text-muted">
              You&apos;re already a member of this team.
            </p>
            <Link
              href={`/team/${team.slug}`}
              className="inline-block rounded-md border border-accent bg-accent/10 px-4 py-2 font-mono text-xs font-medium text-accent transition-all hover:bg-accent/20"
            >
              Go to Team Page
            </Link>
          </div>
        )}

        {(state === "locked" || state === "locked-unauthenticated") && (
          <div>
            <p className="font-mono text-sm text-muted">
              This team is not accepting new members right now.
            </p>
            {state === "locked-unauthenticated" && (
              <div className="mt-4">
                <p className="mb-3 font-mono text-xs text-muted">
                  Already a member? Sign in to check.
                </p>
                {signInSlot}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Back link */}
      <Link
        href="/"
        className="mt-6 inline-block font-mono text-xs text-muted transition-colors hover:text-accent"
      >
        Back to Leaderboard
      </Link>
    </div>
  );
}
