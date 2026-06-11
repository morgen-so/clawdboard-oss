"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface Notification {
  id: string;
  type: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function TeamInviteNotification({
  notification,
  onAccept,
  onDecline,
  acting,
}: {
  notification: Notification;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  acting: string | null;
}) {
  const t = useTranslations("notifications");
  const data = notification.data;
  const teamName = data.teamName as string;
  const invitedBy = data.invitedBy as string;
  const invitedByImage = data.invitedByImage as string | null;
  const isActing = acting === notification.id;

  return (
    <div className="px-4 py-3 transition-colors hover:bg-surface-hover">
      <div className="flex items-start gap-2.5">
        {invitedByImage ? (
          <Image
            src={invitedByImage}
            alt={invitedBy ?? ""}
            width={24}
            height={24}
            className="mt-0.5 h-6 w-6 rounded-full ring-1 ring-border"
          />
        ) : (
          <div className="mt-0.5 h-6 w-6 rounded-full bg-surface ring-1 ring-border" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-foreground/90">
            <span className="font-bold text-accent">{invitedBy}</span>{" "}
            {t("invitedYou")}{" "}
            <span className="font-bold">{teamName}</span>
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted">
            {timeAgo(notification.createdAt)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={isActing}
              onClick={() => onAccept(notification.id)}
              className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 font-mono text-[10px] font-medium text-accent transition-all hover:bg-accent/20 hover:border-accent disabled:opacity-50 cursor-pointer"
            >
              {t("accept")}
            </button>
            <button
              type="button"
              disabled={isActing}
              onClick={() => onDecline(notification.id)}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] font-medium text-muted transition-all hover:border-border-bright hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              {t("decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  useEffect(() => setMounted(true), []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Fetch on mount + poll every 30s, pause when tab hidden
  useEffect(() => {
    fetchNotifications();
    let interval = setInterval(fetchNotifications, 30000);
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchNotifications();
        interval = setInterval(fetchNotifications, 30000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchNotifications]);

  // Click-outside handler
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleAction = async (
    notificationId: string,
    action: "accept" | "decline"
  ) => {
    setActing(notificationId);
    try {
      const formData = new FormData();
      formData.set("notificationId", notificationId);
      const mod = await import("@/actions/notifications");
      const fn =
        action === "accept" ? mod.acceptTeamInvite : mod.declineTeamInvite;
      await fn(undefined, formData);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } finally {
      setActing(null);
    }
  };

  const count = notifications.length;

  const dropdown =
    open && mounted
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-72 rounded-lg border border-border bg-surface shadow-lg"
            style={{ top: dropdownPos.top, right: dropdownPos.right }}
          >
            <div className="border-b border-border px-4 py-2.5">
              <span className="font-mono text-xs font-bold text-foreground">
                {t("title")}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center font-mono text-xs text-muted">
                  {t("noNotifications")}
                </div>
              ) : (
                notifications.map((n) => {
                  if (n.type === "team_invite") {
                    return (
                      <TeamInviteNotification
                        key={n.id}
                        notification={n}
                        onAccept={(id) => handleAction(id, "accept")}
                        onDecline={(id) => handleAction(id, "decline")}
                        acting={acting}
                      />
                    );
                  }
                  return null;
                })
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("title")}
        onClick={() => {
          if (!open && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const rightOffset = window.innerWidth - rect.right;
            setDropdownPos({
              top: rect.bottom + 8,
              right: Math.max(8, rightOffset),
            });
          }
          setOpen(!open);
        }}
        className="relative flex items-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-bold text-background">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {dropdown}
    </>
  );
}
