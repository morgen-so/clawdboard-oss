"use client";

import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { MIN_DATE } from "@/lib/constants";
import { DatePicker } from "@/components/ui/DatePicker";
import { PERIOD_COOKIE, serializePeriodCookie } from "@/lib/period-cookie";
import { useTranslations } from "next-intl";

interface TimeFilterProps {
  current: string;
  from?: string;
  to?: string;
}

const PERIODS = [
  { value: "today", label: "--today" },
  { value: "7d", label: "--7d" },
  { value: "30d", label: "--30d" },
  { value: "this-month", label: "--month" },
  { value: "ytd", label: "--ytd" },
  { value: "custom", label: "--custom" },
] as const;

function formatRangeLabel(from: string, to: string): string {
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  return `${fmt(from)} \u2013 ${fmt(to)}`;
}

function TimeFilterInner({ current, from, to }: TimeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("timeFilter");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const customRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, right: 0, fullWidth: false });

  const today = new Date().toISOString().slice(0, 10);
  const [pickFrom, setPickFrom] = useState(from ?? today);
  const [pickTo, setPickTo] = useState(to ?? today);

  // Reset picker values when props change (inline derived state, no useEffect)
  const propsKey = useMemo(() => `${from ?? ""}-${to ?? ""}`, [from, to]);
  const [prevPropsKey, setPrevPropsKey] = useState(propsKey);
  if (propsKey !== prevPropsKey) {
    setPrevPropsKey(propsKey);
    setPickFrom(from ?? today);
    setPickTo(to ?? today);
  }

  const isCustomActive = current === "custom" && from && to;
  const canApply =
    pickFrom && pickTo && pickFrom <= pickTo && pickFrom >= MIN_DATE && pickTo <= today;

  const navigate = useCallback(
    (period: string, rangeFrom?: string, rangeTo?: string) => {
      document.cookie = `${PERIOD_COOKIE}=${serializePeriodCookie(period, rangeFrom, rangeTo)};path=/;max-age=31536000;SameSite=Lax`;
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", period);
      if (rangeFrom && rangeTo) {
        params.set("from", rangeFrom);
        params.set("to", rangeTo);
      } else {
        params.delete("from");
        params.delete("to");
      }
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Click-outside handler
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        customRef.current &&
        !customRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  // Escape key closes popover
  useEffect(() => {
    if (!popoverOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPopoverOpen(false);
        customRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [popoverOpen]);

  function openPopover() {
    if (customRef.current) {
      const rect = customRef.current.getBoundingClientRect();
      const fullWidth = window.innerWidth < 640;
      setPopoverPos({
        top: rect.bottom + 6,
        right: fullWidth ? 0 : window.innerWidth - rect.right,
        fullWidth,
      });
    }
    setPopoverOpen(true);
  }

  function handleApply() {
    if (!canApply) return;
    navigate("custom", pickFrom, pickTo);
    setPopoverOpen(false);
  }

  const popover = popoverOpen
    ? createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] w-[calc(100vw-2rem)] sm:w-80 rounded-lg border border-border bg-surface shadow-lg p-4"
          style={{
            top: popoverPos.top,
            ...(popoverPos.fullWidth
              ? { left: '1rem', right: '1rem' }
              : { right: popoverPos.right }),
          }}
        >
          <div className="space-y-3">
            <DatePicker
              label={t("from")}
              value={pickFrom}
              min={MIN_DATE}
              max={pickTo || today}
              onChange={setPickFrom}
            />
            <DatePicker
              label={t("to")}
              value={pickTo}
              min={pickFrom || MIN_DATE}
              max={today}
              onChange={setPickTo}
            />
            <button
              disabled={!canApply}
              onClick={handleApply}
              className="w-full rounded-md bg-accent px-3 py-1.5 font-mono text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("apply")}
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className="overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
        <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden w-max sm:w-auto">
          {PERIODS.map((p) => {
            const isActive = current === p.value;
            const isCustom = p.value === "custom";

            if (isCustom) {
              const label =
                isCustomActive
                  ? formatRangeLabel(from!, to!)
                  : p.label;

              return (
                <button
                  key={p.value}
                  ref={customRef}
                  onClick={() => {
                    if (popoverOpen) {
                      setPopoverOpen(false);
                    } else {
                      openPopover();
                    }
                  }}
                  className={`min-h-[40px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 sm:px-3 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-accent text-background"
                      : "text-foreground/60 hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {label}
                </button>
              );
            }

            return (
              <button
                key={p.value}
                onClick={() => {
                  navigate(p.value);
                  setPopoverOpen(false);
                }}
                className={`min-h-[40px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 sm:px-3 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-accent text-background"
                    : "text-foreground/60 hover:text-foreground hover:bg-surface-hover"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      {popover}
    </>
  );
}

function TimeFilterFallback({ current, from, to }: TimeFilterProps) {
  const isCustomActive = current === "custom" && from && to;

  return (
    <div className="overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
      <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden w-max sm:w-auto">
        {PERIODS.map((p) => {
          const isActive = current === p.value;
          const label =
            p.value === "custom" && isCustomActive
              ? formatRangeLabel(from!, to!)
              : p.label;

          return (
            <span
              key={p.value}
              className={`min-h-[40px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 sm:px-3 font-mono text-xs font-medium whitespace-nowrap ${
                isActive
                  ? "bg-accent text-background"
                  : "text-foreground/60"
              }`}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TimeFilter(props: TimeFilterProps) {
  return (
    <Suspense fallback={<TimeFilterFallback {...props} />}>
      <TimeFilterInner {...props} />
    </Suspense>
  );
}
