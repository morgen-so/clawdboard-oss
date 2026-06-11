"use client";

import { useMemo } from "react";
import type { RecapData } from "@/lib/db/schema";
import { GenerativePattern } from "../visuals/GenerativePattern";
import { formatUsd } from "@/lib/format";

interface SlideRhythmProps {
  data: RecapData;
  type: string;
  periodStart: string;
  periodEnd: string;
}

const DAY_LABELS_SHORT = ["M", "T", "W", "T", "F", "S", "S"];

function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (current <= endDate) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Generate pseudo-random activity intensity per day from a seed.
 * Deterministic so the grid looks the same every time.
 */
function generateDayIntensities(
  dates: string[],
  activeDays: number,
  peakDay: string | null,
  seed: number
): Map<string, number> {
  const map = new Map<string, number>();
  // Simple seeded random
  let s = seed;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  // Distribute activity across days
  const activeCount = Math.min(activeDays, dates.length);
  const activeIndices = new Set<number>();

  // Peak day is always active
  if (peakDay) {
    const peakIdx = dates.indexOf(peakDay);
    if (peakIdx >= 0) activeIndices.add(peakIdx);
  }

  // Fill remaining active days
  while (activeIndices.size < activeCount) {
    const idx = Math.floor(rng() * dates.length);
    activeIndices.add(idx);
  }

  for (let i = 0; i < dates.length; i++) {
    if (dates[i] === peakDay) {
      map.set(dates[i], 1.0); // Peak = full intensity
    } else if (activeIndices.has(i)) {
      map.set(dates[i], 0.3 + rng() * 0.5); // Active = 30-80%
    } else {
      map.set(dates[i], 0); // Inactive
    }
  }
  return map;
}

function getHeatColor(intensity: number): string {
  if (intensity === 0) return "rgba(255,255,255,0.03)";
  if (intensity >= 0.9) return "rgba(249,166,21,0.9)"; // Accent full
  if (intensity >= 0.6) return "rgba(249,166,21,0.5)";
  if (intensity >= 0.3) return "rgba(249,166,21,0.25)";
  return "rgba(249,166,21,0.12)";
}

function WeekGrid({
  periodStart,
  periodEnd,
  peakDay,
  intensities,
}: {
  periodStart: string;
  periodEnd: string;
  peakDay: string | null;
  intensities: Map<string, number>;
}) {
  const dates = getDateRange(periodStart, periodEnd);

  return (
    <div className="flex gap-3 justify-center">
      {dates.map((date, i) => {
        const dayOfWeek = new Date(date + "T12:00:00Z").getUTCDay();
        const labelIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const isPeak = date === peakDay;
        const intensity = intensities.get(date) ?? 0;

        return (
          <div key={date} className="flex flex-col items-center gap-2">
            <span className="font-mono text-[10px] text-white/30">
              {DAY_LABELS_SHORT[labelIndex]}
            </span>
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-500 animate-fade-in relative"
              style={{
                animationDelay: `${400 + i * 100}ms`,
                backgroundColor: getHeatColor(intensity),
                boxShadow: isPeak
                  ? "0 0 12px rgba(249,166,21,0.4)"
                  : "none",
              }}
            >
              <span
                className={`font-mono text-sm ${
                  isPeak
                    ? "text-background font-bold"
                    : intensity > 0
                      ? "text-white/60"
                      : "text-white/15"
                }`}
              >
                {new Date(date + "T12:00:00Z").getUTCDate()}
              </span>
              {/* Activity bar below */}
              {intensity > 0 && (
                <div
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-accent"
                  style={{
                    width: `${Math.max(4, intensity * 24)}px`,
                    opacity: intensity,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({
  periodStart,
  periodEnd,
  peakDay,
  intensities,
}: {
  periodStart: string;
  periodEnd: string;
  peakDay: string | null;
  intensities: Map<string, number>;
}) {
  const dates = getDateRange(periodStart, periodEnd);
  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col gap-1 items-center">
      <div className="flex gap-1 mb-1">
        {DAY_LABELS_SHORT.map((d, i) => (
          <div key={i} className="w-7 text-center">
            <span className="font-mono text-[8px] text-white/20">{d}</span>
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="flex gap-1">
          {week.map((date, di) => {
            const isPeak = date === peakDay;
            const intensity = intensities.get(date) ?? 0;
            return (
              <div
                key={date}
                className="h-7 w-7 rounded flex items-center justify-center animate-fade-in"
                style={{
                  animationDelay: `${300 + (wi * 7 + di) * 30}ms`,
                  backgroundColor: getHeatColor(intensity),
                  boxShadow: isPeak
                    ? "0 0 8px rgba(249,166,21,0.3)"
                    : "none",
                }}
              >
                {(isPeak || intensity > 0.5) && (
                  <span
                    className={`font-mono text-[8px] ${
                      isPeak
                        ? "text-background font-bold text-[9px]"
                        : "text-white/40"
                    }`}
                  >
                    {new Date(date + "T12:00:00Z").getUTCDate()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function SlideRhythm({
  data,
  type,
  periodStart,
  periodEnd,
}: SlideRhythmProps) {
  const dates = useMemo(
    () => getDateRange(periodStart, periodEnd),
    [periodStart, periodEnd]
  );
  const intensities = useMemo(
    () =>
      generateDayIntensities(
        dates,
        data.activeDays,
        data.peakDay,
        data.rank * 7919 + Math.round(data.totalCost * 100)
      ),
    [dates, data.activeDays, data.peakDay, data.rank, data.totalCost]
  );

  return (
    <div className="relative flex flex-col items-center text-center gap-6">
      {/* Subtle circuit pattern behind */}
      <GenerativePattern
        rank={data.rank}
        totalCost={data.totalCost}
        streak={data.currentStreak}
        tier={data.stateTier}
        variant="circuits"
      />

      {/* Heading */}
      <p className="font-mono text-xs text-white/40 uppercase tracking-widest animate-fade-in relative z-10">
        Your Rhythm
      </p>

      {/* Activity grid with heatmap */}
      <div className="relative z-10">
        {type === "weekly" ? (
          <WeekGrid
            periodStart={periodStart}
            periodEnd={periodEnd}
            peakDay={data.peakDay}
            intensities={intensities}
          />
        ) : (
          <MonthGrid
            periodStart={periodStart}
            periodEnd={periodEnd}
            peakDay={data.peakDay}
            intensities={intensities}
          />
        )}
      </div>

      {/* Stats row */}
      <div className="relative z-10 flex items-center gap-6">
        <div
          className="flex flex-col items-center gap-1 animate-fade-in"
          style={{ animationDelay: "800ms" }}
        >
          <span className="font-display text-3xl font-bold text-white">
            {data.activeDays}
          </span>
          <span className="font-mono text-[10px] text-white/30">
            of {data.totalDays} days
          </span>
        </div>

        <div
          className="h-10 w-px bg-white/10 animate-fade-in"
          style={{ animationDelay: "900ms" }}
        />

        <div
          className="flex flex-col items-center gap-1 animate-fade-in"
          style={{ animationDelay: "1000ms" }}
        >
          <span className="font-display text-3xl font-bold text-accent">
            {data.currentStreak}
          </span>
          <span className="font-mono text-[10px] text-white/30">
            day streak
          </span>
        </div>
      </div>

      {/* Peak day callout */}
      {data.peakDay && (
        <div
          className="relative z-10 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 animate-fade-in"
          style={{ animationDelay: "1200ms" }}
        >
          <p className="font-mono text-xs text-white/50">
            You went hardest on{" "}
            <span className="text-accent font-semibold">
              {data.peakDayLabel}
            </span>
          </p>
          <p className="font-mono text-[10px] text-white/30 mt-0.5">
            {formatUsd(data.peakDayCost)}{" "}
            that day
          </p>
        </div>
      )}
    </div>
  );
}
