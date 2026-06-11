"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useLocale } from "next-intl";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
  isBefore,
  isAfter,
  isToday,
  format,
  parseISO,
} from "date-fns";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  label?: string;
}

export function DatePicker({ value, onChange, min, max, label }: DatePickerProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() =>
    value ? startOfMonth(parseISO(value)) : startOfMonth(new Date())
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Localized 2-char weekday headers, Sunday-first to match the calendar grid
  const daysOfWeek = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      timeZone: "UTC",
    });
    // 2021-01-03 is a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      formatter.format(new Date(Date.UTC(2021, 0, 3 + i))).slice(0, 2)
    );
  }, [locale]);

  const selectedDate = useMemo(() => (value ? parseISO(value) : null), [value]);
  const minDate = useMemo(() => (min ? parseISO(min) : null), [min]);
  const maxDate = useMemo(() => (max ? parseISO(max) : null), [max]);

  // Only compute the calendar grid when the dropdown is open
  const { paddedDays, monthStart } = useMemo(() => {
    if (!open) return { paddedDays: [] as Date[], monthStart: viewDate };
    const ms = startOfMonth(viewDate);
    const calStart = startOfWeek(ms);
    const calEnd = endOfWeek(endOfMonth(ms));
    const days = eachDayOfInterval({ start: calStart, end: calEnd });
    // Pad to 42 cells (6 rows) for consistent height
    while (days.length < 42) {
      const last = days[days.length - 1];
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      days.push(next);
    }
    return { paddedDays: days, monthStart: ms };
  }, [open, viewDate]);

  function isDisabled(day: Date) {
    if (minDate && isBefore(day, minDate)) return true;
    if (maxDate && isAfter(day, maxDate)) return true;
    return false;
  }

  const canGoPrev = !minDate || isAfter(monthStart, startOfMonth(minDate));
  const canGoNext = !maxDate || isBefore(monthStart, startOfMonth(maxDate));

  // Click-outside closes calendar only (not parent popover)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape closes calendar with stopPropagation
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  function handleSelect(day: Date) {
    if (isDisabled(day)) return;
    onChange(format(day, "yyyy-MM-dd"));
    setOpen(false);
  }

  function handleToggle() {
    if (!open && selectedDate) {
      setViewDate(startOfMonth(selectedDate));
    }
    setOpen((prev) => !prev);
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block font-mono text-[10px] font-medium uppercase tracking-widest text-dim mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground text-left outline-none focus:border-accent transition-colors"
      >
        {value || <span className="text-dim">YYYY-MM-DD</span>}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-[252px] rounded-lg border border-border bg-surface p-3 shadow-lg">
          {/* Month/year header */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => canGoPrev && setViewDate(subMonths(viewDate, 1))}
              disabled={!canGoPrev}
              className="px-1.5 py-0.5 font-mono text-xs text-foreground/60 hover:text-foreground disabled:text-dim/40 disabled:cursor-not-allowed transition-colors"
            >
              &lt;
            </button>
            <span className="font-mono text-xs font-medium text-foreground">
              {format(viewDate, "MMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => canGoNext && setViewDate(addMonths(viewDate, 1))}
              disabled={!canGoNext}
              className="px-1.5 py-0.5 font-mono text-xs text-foreground/60 hover:text-foreground disabled:text-dim/40 disabled:cursor-not-allowed transition-colors"
            >
              &gt;
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {daysOfWeek.map((d, i) => (
              <div
                key={i}
                className="text-center font-mono text-[10px] uppercase tracking-widest text-dim py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {paddedDays.map((day, i) => {
              const inMonth = isSameMonth(day, viewDate);
              const selected = selectedDate && isSameDay(day, selectedDate);
              const today = isToday(day);
              const disabled = isDisabled(day);

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelect(day)}
                  disabled={disabled}
                  className={`
                    h-8 w-8 mx-auto flex items-center justify-center rounded font-mono text-xs transition-colors
                    ${selected ? "bg-accent text-background font-medium" : ""}
                    ${!selected && today && inMonth ? "text-accent" : ""}
                    ${!selected && !today && inMonth && !disabled ? "text-foreground hover:bg-surface-hover" : ""}
                    ${!inMonth && !disabled ? "text-dim/30 hover:bg-surface-hover" : ""}
                    ${disabled ? "text-dim/40 cursor-not-allowed" : "cursor-pointer"}
                  `}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
