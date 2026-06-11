"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useModalDismiss } from "@/components/ui/useModalDismiss";
import { deleteAccount } from "@/actions/users";
import { useTranslations } from "next-intl";

interface DeleteAccountDialogProps {
  username: string;
  onClose: () => void;
}

export function DeleteAccountDialog({
  username,
  onClose,
}: DeleteAccountDialogProps) {
  const t = useTranslations("deleteAccount");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stableClose = useCallback(() => onCloseRef.current(), []);

  const matches = confirmation === username;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useModalDismiss(true, stableClose);

  async function handleDelete() {
    if (!matches) return;
    setPending(true);
    setError(null);
    try {
      const result = await deleteAccount();
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      // Sign out and redirect after deletion
      const { signOut } = await import("next-auth/react");
      signOut({ callbackUrl: "/" });
    } catch {
      setError(t("genericError"));
      setPending(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm mx-4 rounded-lg border border-red-500/30 bg-surface shadow-xl">
        <div className="p-5">
          <h2 className="font-display text-base font-semibold text-foreground mb-1">
            <span className="text-red-400 mr-2">&gt;</span>
            {t("title")}
          </h2>
          <p className="font-mono text-xs text-muted mb-4 leading-relaxed">
            {t("description")}
          </p>

          <label
            htmlFor="delete-confirmation"
            className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted"
          >
            {t("typeToConfirm", { username })}
          </label>
          <input
            id="delete-confirmation"
            ref={inputRef}
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={username}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />

          {error && (
            <p className="mt-2 font-mono text-xs text-red-400">{error}</p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={!matches || pending}
              onClick={handleDelete}
              className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 font-mono text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? t("deleting") : t("deleteMyAccount")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-md px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:text-foreground"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
