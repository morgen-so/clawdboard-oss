"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShareModal } from "./ShareModal";
import { ShareIcon } from "@/components/icons/CommonIcons";

interface ShareButtonsProps {
  username: string;
  image: string | null;
  rank: number;
  streak: number;
  totalCost: string;
  totalTokens: number;
  totalUsers: number;
  percentile: number;
  profileUrl: string;
}

/** Share icon (box with arrow) */
export function ShareButtons({
  username,
  image,
  rank,
  streak,
  totalCost,
  totalTokens,
  totalUsers,
  percentile,
  profileUrl,
}: ShareButtonsProps) {
  const t = useTranslations("profile");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:border-border-bright text-muted hover:text-foreground transition-colors text-xs font-mono cursor-pointer"
      >
        <ShareIcon size={16} />
        {t("share")}
      </button>
      <ShareModal
        open={open}
        onClose={() => setOpen(false)}
        username={username}
        image={image}
        totalCost={totalCost}
        totalTokens={totalTokens}
        rank={rank}
        totalUsers={totalUsers}
        percentile={percentile}
        streak={streak}
        profileUrl={profileUrl}
      />
    </>
  );
}
