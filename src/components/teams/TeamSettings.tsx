"use client";

import Image from "next/image";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  rotateInviteToken,
  toggleTeamLock,
  toggleTeamPublic,
  removeMember,
  transferOwnership,
  leaveTeam,
  renameTeam,
  updateTeamCookingUrl,
  clearTeamCookingUrl,
} from "@/actions/teams";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

interface TeamData {
  id: string;
  name: string;
  slug: string;
  inviteToken: string;
  isPublic: boolean | null;
  isLocked: boolean | null;
  cookingUrl: string | null;
  cookingLabel: string | null;
}

interface MemberData {
  userId: string;
  githubUsername: string | null;
  image: string | null;
  role: string;
  status: string;
  joinedAt: Date | null;
  leftAt: Date | null;
}

interface TeamSettingsProps {
  team: TeamData;
  members: MemberData[];
  currentUserId: string;
  isLastOwner: boolean;
  isOwner: boolean;
}

export function TeamSettings({
  team,
  members,
  currentUserId,
  isLastOwner,
  isOwner,
}: TeamSettingsProps) {
  const activeMembers = members.filter((m) => !m.leftAt);
  const t = useTranslations("team");

  const [rotateState, rotateAction] = useActionState(rotateInviteToken, undefined);
  const [lockState, lockAction] = useActionState(toggleTeamLock, undefined);
  const [renameState, renameAction] = useActionState(renameTeam, undefined);
  const [cookingState, cookingAction] = useActionState(updateTeamCookingUrl, undefined);
  const [clearCookingState, clearCookingAction] = useActionState(clearTeamCookingUrl, undefined);
  const [publicState, publicAction] = useActionState(toggleTeamPublic, undefined);
  const [leaveState, leaveAction] = useActionState(leaveTeam, undefined);
  const [removeState, removeAction] = useActionState(removeMember, undefined);
  const [transferState, transferAction] = useActionState(transferOwnership, undefined);

  return (
    <div className="space-y-6">
      {/* Owner-only sections */}
      {isOwner && (
        <>
          {/* Access & Invites */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-foreground">
              {t("accessAndInvites")}
            </h3>
            <div className="flex flex-wrap gap-2">
              <form action={rotateAction}>
                <input type="hidden" name="teamId" value={team.id} />
                <SubmitButton
                  pendingText={t("rotating")}
                  className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
                >
                  {t("rotateToken")}
                </SubmitButton>
              </form>
              <form action={lockAction}>
                <input type="hidden" name="teamId" value={team.id} />
                <SubmitButton
                  className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
                >
                  {team.isLocked ? t("unlockJoins") : t("lockJoins")}
                </SubmitButton>
              </form>
            </div>
            {team.isLocked && (
              <p className="mt-2 font-mono text-xs text-red-400">
                {t("teamLockedMessage")}
              </p>
            )}
            {rotateState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{rotateState.error}</p>
            )}
            {lockState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{lockState.error}</p>
            )}
          </section>

          {/* Team Name */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-foreground">
              {t("teamName")}
            </h3>
            <form action={renameAction} className="flex gap-2">
              <input type="hidden" name="teamId" value={team.id} />
              <input
                name="name"
                type="text"
                defaultValue={team.name}
                maxLength={50}
                aria-label={t("teamName")}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <SubmitButton
                pendingText={t("renaming")}
                className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 font-mono text-xs font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
              >
                {t("rename")}
              </SubmitButton>
            </form>
            {renameState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{renameState.error}</p>
            )}
          </section>

          {/* Cooking Link */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-foreground">
              &#129489;&#8205;&#127859; {t("cookingLink")}
            </h3>
            <p className="mb-3 font-mono text-xs text-muted">
              {t("cookingLinkDescription")}
            </p>
            <form action={cookingAction} className="space-y-3">
              <input type="hidden" name="teamId" value={team.id} />
              <div className="flex gap-2">
                <input
                  name="cookingLabel"
                  type="text"
                  maxLength={50}
                  defaultValue={team.cookingLabel ?? ""}
                  placeholder={t("projectName")}
                  aria-label={t("projectName")}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                  name="cookingUrl"
                  type="url"
                  defaultValue={team.cookingUrl ?? ""}
                  placeholder="https://..."
                  aria-label={t("projectUrl")}
                  className="flex-[2] rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex gap-2">
                <SubmitButton
                  pendingText={t("saving")}
                  className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 font-mono text-xs font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
                >
                  {t("save")}
                </SubmitButton>
              </div>
            </form>
            {team.cookingUrl && (
              <form action={clearCookingAction} className="mt-2">
                <input type="hidden" name="teamId" value={team.id} />
                <SubmitButton
                  pendingText={t("removing")}
                  className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
                >
                  {t("remove")}
                </SubmitButton>
              </form>
            )}
            {cookingState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{cookingState.error}</p>
            )}
            {clearCookingState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{clearCookingState.error}</p>
            )}
          </section>

          {/* Public Visibility */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-2 font-display text-sm font-bold text-foreground">
              {t("publicVisibility")}
            </h3>
            <p className="mb-3 font-mono text-xs text-muted">
              {t("publicVisibilityDescription")}
            </p>
            <form action={publicAction}>
              <input type="hidden" name="teamId" value={team.id} />
              <SubmitButton
                className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
              >
                {team.isPublic ? t("makePrivate") : t("makePublic")}
              </SubmitButton>
            </form>
            {team.isPublic && (
              <p className="mt-2 font-mono text-xs text-accent">
                {t("teamIsPublic")}
              </p>
            )}
            {publicState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{publicState.error}</p>
            )}
          </section>

          {/* Members */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-foreground">
              {t("membersCount", { count: activeMembers.length })}
            </h3>
            <div className="space-y-2">
              {activeMembers.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {member.image && (
                      <Image
                        src={member.image}
                        alt={member.githubUsername ?? ""}
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    <span className="font-mono text-sm text-foreground">
                      {member.githubUsername ?? "Unknown"}
                    </span>
                    {member.role === "owner" && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
                        {t("owner")}
                      </span>
                    )}
                    {member.status === "pending" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-medium text-accent">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        {t("pending")}
                      </span>
                    )}
                  </div>
                  {member.userId !== currentUserId && (
                    <div className="flex gap-1">
                      {member.role !== "owner" && (
                        <form action={transferAction}>
                          <input type="hidden" name="teamId" value={team.id} />
                          <input
                            type="hidden"
                            name="newOwnerId"
                            value={member.userId}
                          />
                          <SubmitButton
                            className="rounded px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:text-accent disabled:opacity-50"
                          >
                            {t("makeOwner")}
                          </SubmitButton>
                        </form>
                      )}
                      <form action={removeAction}>
                        <input type="hidden" name="teamId" value={team.id} />
                        <input
                          type="hidden"
                          name="memberId"
                          value={member.userId}
                        />
                        <ConfirmButton
                          message={t("removeConfirm", { name: member.githubUsername ?? "this member" })}
                          className="rounded px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:text-red-400 disabled:opacity-50"
                        >
                          {t("removeMember")}
                        </ConfirmButton>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {transferState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{transferState.error}</p>
            )}
            {removeState?.error && (
              <p className="mt-2 font-mono text-xs text-red-400">{removeState.error}</p>
            )}
          </section>
        </>
      )}

      {/* Your Membership — visible to ALL roles */}
      <section className="rounded-lg border border-red-500/30 bg-surface p-4">
        <h3 className="mb-2 font-display text-sm font-bold text-red-400">
          {t("yourMembership")}
        </h3>
        {isLastOwner && isOwner && (
          <p className="mb-3 font-mono text-xs text-red-400">
            {t("lastOwnerWarning")}
          </p>
        )}
        <form action={leaveAction}>
          <input type="hidden" name="teamId" value={team.id} />
          <ConfirmButton
            message={t("leaveConfirm")}
            disabled={isLastOwner && isOwner}
            className="rounded-md border border-red-500/40 px-3 py-1.5 font-mono text-xs text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("leaveTeam")}
          </ConfirmButton>
        </form>
        {leaveState?.error && (
          <p className="mt-2 font-mono text-xs text-red-400">{leaveState.error}</p>
        )}
      </section>
    </div>
  );
}
