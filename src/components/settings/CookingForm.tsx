"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateCookingUrl } from "@/actions/users";

interface CookingFormProps {
  currentUrl: string | null;
  currentLabel: string | null;
}

export function CookingForm({ currentUrl, currentLabel }: CookingFormProps) {
  const t = useTranslations("settings");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateCookingUrl(undefined, formData);
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      setSaved(true);
      setPending(false);
    } catch {
      setPending(false);
    }
  }

  async function handleRemove() {
    setPending(true);
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("cookingUrl", "");
    fd.set("cookingLabel", "");
    try {
      const result = await updateCookingUrl(undefined, fd);
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      setSaved(true);
      setPending(false);
    } catch {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor="cooking-label"
          className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted"
        >
          {t("projectName")}
        </label>
        <input
          id="cooking-label"
          name="cookingLabel"
          type="text"
          maxLength={50}
          defaultValue={currentLabel ?? ""}
          placeholder={t("projectNamePlaceholder")}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div>
        <label
          htmlFor="cooking-url"
          className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted"
        >
          {t("url")}
        </label>
        <input
          id="cooking-url"
          name="cookingUrl"
          type="url"
          defaultValue={currentUrl ?? ""}
          placeholder="https://myapp.com"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      {error && (
        <p className="font-mono text-xs text-red-400">{error}</p>
      )}
      {saved && (
        <p className="font-mono text-xs text-green-400">{t("saved")}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 font-mono text-xs font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? t("saving") : t("save")}
        </button>
        {currentUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={pending}
            className="rounded-md px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:text-red-400 disabled:opacity-50"
          >
            {t("remove")}
          </button>
        )}
      </div>
    </form>
  );
}
