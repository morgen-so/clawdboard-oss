"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { env } from "@/lib/env";
import { buildInviteUrl } from "@/lib/url";
import { UserSearchInvite } from "./UserSearchInvite";
import { CheckIcon } from "@/components/icons/CommonIcons";

type CopyAction = "link" | "slack";
type InviteTab = "link" | "search";

interface TeamInviteSectionProps {
  teamSlug: string;
  teamId: string;
  inviteToken: string;
  isLocked: boolean;
  memberCount: number;
}

function CopiedLabel({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckIcon />
      {text}
    </span>
  );
}

function InviteActions({
  inviteUrl,
  slackMessage,
  emailSubject,
  emailBody,
  labels,
}: {
  inviteUrl: string;
  slackMessage: string;
  emailSubject: string;
  emailBody: string;
  labels: { copyLink: string; copyForSlack: string; emailInvite: string; copied: string };
}) {
  const [copiedAction, setCopiedAction] = useState<CopyAction | null>(null);

  const handleCopy = async (text: string, action: CopyAction) => {
    await navigator.clipboard.writeText(text);
    setCopiedAction(action);
    setTimeout(() => setCopiedAction(null), 2000);
  };

  const btnClass =
    "rounded-md border border-border px-3 py-1.5 font-mono text-xs font-medium text-muted transition-all hover:border-border-bright hover:text-foreground cursor-pointer";

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => handleCopy(inviteUrl, "link")}
        className={btnClass}
      >
        {copiedAction === "link" ? <CopiedLabel text={labels.copied} /> : labels.copyLink}
      </button>
      <button
        type="button"
        onClick={() => handleCopy(slackMessage, "slack")}
        className={btnClass}
      >
        {copiedAction === "slack" ? <CopiedLabel text={labels.copied} /> : labels.copyForSlack}
      </button>
      <a
        href={`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`}
        className={btnClass + " inline-flex items-center no-underline"}
      >
        {labels.emailInvite}
      </a>
    </div>
  );
}

function InviteTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: InviteTab;
  onTabChange: (tab: InviteTab) => void;
}) {
  const t = useTranslations("team");
  const tabClass = (tab: InviteTab) =>
    `px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors cursor-pointer ${
      activeTab === tab
        ? "text-accent border-b-2 border-accent"
        : "text-muted hover:text-foreground border-b-2 border-transparent"
    }`;

  return (
    <div className="mb-3 flex gap-1 border-b border-border">
      <button type="button" onClick={() => onTabChange("link")} className={tabClass("link")}>
        {t("shareLink")}
      </button>
      <button type="button" onClick={() => onTabChange("search")} className={tabClass("search")}>
        {t("searchClawdboard")}
      </button>
    </div>
  );
}

function InviteContent({
  tab,
  teamId,
  inviteUrl,
  slackMessage,
  emailSubject,
  emailBody,
  labels,
}: {
  tab: InviteTab;
  teamId: string;
  inviteUrl: string;
  slackMessage: string;
  emailSubject: string;
  emailBody: string;
  labels: { copyLink: string; copyForSlack: string; emailInvite: string; copied: string };
}) {
  if (tab === "search") {
    return <UserSearchInvite teamId={teamId} />;
  }
  return (
    <InviteActions
      inviteUrl={inviteUrl}
      slackMessage={slackMessage}
      emailSubject={emailSubject}
      emailBody={emailBody}
      labels={labels}
    />
  );
}

export function TeamInviteSection({
  teamSlug,
  teamId,
  inviteToken,
  isLocked,
  memberCount,
}: TeamInviteSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<InviteTab>("link");
  const t = useTranslations("team");

  const inviteUrl = buildInviteUrl(env.NEXT_PUBLIC_BASE_URL, teamSlug, inviteToken);
  const slackMessage = t("slackMessage", { url: inviteUrl });
  const emailSubject = t("emailSubject");
  const emailBody = t("emailBody", { url: inviteUrl });

  const labels = {
    copyLink: t("copyLink"),
    copyForSlack: t("copyForSlack"),
    emailInvite: t("emailInvite"),
    copied: t("copied"),
  };

  const isProminent = memberCount < 5;

  if (isProminent) {
    return (
      <div
        className={`mb-6 rounded-lg border p-4 ${
          isLocked
            ? "border-border bg-card/50"
            : "border-accent/30 bg-accent/5"
        }`}
      >
        <div className="mb-1 font-mono text-sm font-bold text-foreground">
          <span className="text-accent mr-1">$</span> {t("invite")}
        </div>
        {isLocked ? (
          <p className="font-mono text-xs text-muted">
            {t("teamLocked")}
          </p>
        ) : (
          <>
            <p className="mb-3 font-mono text-xs text-muted">
              {t("growTeam")}
            </p>
            <InviteTabs activeTab={activeTab} onTabChange={setActiveTab} />
            <InviteContent
              tab={activeTab}
              teamId={teamId}
              inviteUrl={inviteUrl}
              slackMessage={slackMessage}
              emailSubject={emailSubject}
              emailBody={emailBody}
              labels={labels}
            />
          </>
        )}
      </div>
    );
  }

  // Compact mode (5+ members)
  return (
    <div className="mb-6">
      {isLocked ? (
        <button
          type="button"
          disabled
          className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted cursor-not-allowed opacity-50"
          title={t("teamLocked")}
        >
          + {t("inviteColleagues")}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="rounded-full border border-accent/40 px-4 py-1.5 font-mono text-xs text-accent transition-all hover:bg-accent/10 hover:border-accent cursor-pointer"
          >
            {expanded ? `\u2212 ${t("inviteColleagues")}` : `+ ${t("inviteColleagues")}`}
          </button>
          {expanded && (
            <div
              className="mt-3"
              style={{ animation: "fadeInUp 0.2s ease-out both" }}
            >
              <InviteTabs activeTab={activeTab} onTabChange={setActiveTab} />
              <InviteContent
                tab={activeTab}
                teamId={teamId}
                inviteUrl={inviteUrl}
                slackMessage={slackMessage}
                emailSubject={emailSubject}
                emailBody={emailBody}
                labels={labels}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
