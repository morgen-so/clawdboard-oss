"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

interface TeamSwitcherProps {
  teams: Array<{
    teamId: string;
    teamName: string;
    teamSlug: string;
    role: string;
  }>;
  currentSlug: string;
}

function TeamSwitcherInner({ teams, currentSlug }: TeamSwitcherProps) {
  const t = useTranslations("team");
  const router = useRouter();
  const searchParams = useSearchParams();

  if (teams.length <= 1) {
    const team = teams[0];
    return (
      <span className="font-mono text-sm text-foreground">
        {team?.teamName ?? "Team"}
      </span>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("team");
    const qs = params.toString();
    router.push(`/team/${e.target.value}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <select
      value={currentSlug}
      onChange={handleChange}
      aria-label={t("switchTeam")}
      className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {teams.map((team) => (
        <option key={team.teamId} value={team.teamSlug}>
          {team.teamName}
          {team.role === "owner" ? " (owner)" : ""}
        </option>
      ))}
    </select>
  );
}

function TeamSwitcherFallback({ teams, currentSlug }: TeamSwitcherProps) {
  if (teams.length <= 1) {
    const team = teams[0];
    return (
      <span className="font-mono text-sm text-foreground">
        {team?.teamName ?? "Team"}
      </span>
    );
  }

  const activeTeam = teams.find((t) => t.teamSlug === currentSlug) ?? teams[0];
  return (
    <span className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm text-foreground">
      {activeTeam.teamName}
    </span>
  );
}

export function TeamSwitcher(props: TeamSwitcherProps) {
  return (
    <Suspense fallback={<TeamSwitcherFallback {...props} />}>
      <TeamSwitcherInner {...props} />
    </Suspense>
  );
}
