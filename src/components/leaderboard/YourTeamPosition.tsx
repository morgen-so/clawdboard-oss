"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { TeamLeaderboardRow } from "@/lib/db/teams";
import { formatCostNumber } from "@/lib/format";

interface YourTeamPositionProps {
  /** User's team (undefined = no team) */
  team?: { teamName: string; teamSlug: string };
  /** Team's row from the public leaderboard (undefined = private or not ranked) */
  publicRow?: TeamLeaderboardRow;
}

export function YourTeamPosition({ team, publicRow }: YourTeamPositionProps) {
  return (
    <div className="mb-4 rounded-lg border border-accent/20 bg-accent/[0.03]">
      <div className="px-4 pt-3 pb-1">
        <span className="font-mono text-[10px] tracking-widest text-accent/60 font-medium">
          <span className="text-accent/40 select-none">$ </span>team
        </span>
      </div>

      {!team ? (
        <NoTeamBar />
      ) : publicRow ? (
        <PublicTeamBar row={publicRow} />
      ) : (
        <PrivateTeamBar teamName={team.teamName} />
      )}
    </div>
  );
}

function NoTeamBar() {
  const t = useTranslations("team");

  return (
    <Link
      href="/my-team"
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
    >
      <span className="font-mono text-sm text-foreground/80">
        {t("noTeamYet")}
      </span>

      <span className="ml-auto font-mono text-sm font-medium text-accent transition-colors group-hover:text-accent/80">
        {t("createOrJoinTeam")} &rarr;
      </span>
    </Link>
  );
}

function PublicTeamBar({ row }: { row: TeamLeaderboardRow }) {
  const t = useTranslations("team");

  return (
    <Link
      href="/my-team"
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
    >
      <span className="font-mono text-sm font-medium text-foreground/80">
        {row.teamName}
      </span>

      <span className="text-foreground/20 select-none">&middot;</span>
      <span className="font-mono text-sm tabular-nums text-foreground/70">
        #{row.rank}
      </span>

      <span className="text-foreground/20 select-none">&middot;</span>
      <span className="font-mono text-sm tabular-nums text-foreground/70">
        <span className="text-muted">$</span>
        {formatCostNumber(row.totalCost)}
      </span>

      <span className="text-foreground/20 select-none">&middot;</span>
      <span className="font-mono text-sm tabular-nums text-foreground/70">
        {t("memberCount", { count: row.activeMembers })}
      </span>

      <span className="ml-auto text-foreground/30 transition-colors group-hover:text-accent">
        &rarr;
      </span>
    </Link>
  );
}

function PrivateTeamBar({ teamName }: { teamName: string }) {
  const t = useTranslations("team");

  return (
    <Link
      href="/my-team"
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
    >
      <span className="font-mono text-sm font-medium text-foreground/80">
        {teamName}
      </span>

      <span className="text-foreground/20 select-none">&middot;</span>
      <span className="rounded-full bg-border/50 px-2 py-0.5 font-mono text-[10px] text-muted">
        {t("private")}
      </span>

      <span className="ml-auto text-foreground/30 transition-colors group-hover:text-accent">
        &rarr;
      </span>
    </Link>
  );
}
