"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { RecapRow } from "@/lib/db/recaps";
import type { RecapData } from "@/lib/db/schema";
import { SlideHook } from "./slides/SlideHook";
import { SlideRank } from "./slides/SlideRank";
import { SlideUsage } from "./slides/SlideUsage";
import { SlideRhythm } from "./slides/SlideRhythm";
import { SlideShare } from "./slides/SlideShare";
import { SlideEmpty } from "./slides/SlideEmpty";

interface RecapStoriesProps {
  recap: RecapRow;
  onClose: () => void;
}

export function RecapStories({ recap, onClose }: RecapStoriesProps) {
  const tCommon = useTranslations("common");
  const data = recap.data as RecapData;
  const isEmptyState = data.stateTier === "empty";

  // Empty state = single slide
  const totalSlides = isEmptyState ? 1 : 5;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const goForward = useCallback(() => {
    if (currentSlide < totalSlides - 1) {
      setDirection("forward");
      setCurrentSlide((s) => s + 1);
    } else {
      onClose();
    }
  }, [currentSlide, totalSlides, onClose]);

  const goBackward = useCallback(() => {
    if (currentSlide > 0) {
      setDirection("backward");
      setCurrentSlide((s) => s - 1);
    }
  }, [currentSlide]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goForward();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBackward();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goForward, goBackward]);

  // Touch/swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goForward();
      else goBackward();
    }
    touchStartX.current = null;
  };

  // Click navigation — left 40% goes back, right 60% goes forward
  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking a button or interactive element
    if ((e.target as HTMLElement).closest("button, a, [role='button']")) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;

    if (ratio < 0.4) goBackward();
    else goForward();
  };

  const periodLabel =
    recap.type === "weekly" ? "Weekly Recap" : "Monthly Recap";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Stories container — phone-shaped on desktop, full viewport on mobile */}
      <div
        ref={containerRef}
        className="relative flex h-full w-full flex-col overflow-hidden sm:h-[min(90vh,720px)] sm:w-[min(90vw,420px)] sm:rounded-2xl sm:border sm:border-border"
        style={{ background: "linear-gradient(180deg, rgba(10,10,12,0.95) 0%, rgba(17,17,19,0.95) 100%)" }}
        onClick={handleClick}
      >
        {/* Progress bar */}
        <div className="absolute left-0 right-0 top-0 z-30 flex gap-1 px-3 pt-3">
          {Array.from({ length: totalSlides }, (_, i) => (
            <div key={i} className="h-0.5 flex-1 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: i < currentSlide ? "100%" : i === currentSlide ? "100%" : "0%",
                  backgroundColor: i <= currentSlide ? "var(--accent)" : "transparent",
                }}
              />
            </div>
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-3 top-8 z-30 rounded-full bg-white/10 p-1.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white cursor-pointer"
          aria-label={tCommon("close")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Slide content */}
        <div className="relative flex flex-1 items-center justify-center px-6 pt-14 pb-8">
          <div
            key={currentSlide}
            className={`w-full ${direction === "forward" ? "animate-slide-in-right" : "animate-slide-in-left"}`}
          >
            {isEmptyState ? (
              <SlideEmpty data={data} periodLabel={periodLabel} periodStart={recap.periodStart} periodEnd={recap.periodEnd} />
            ) : (
              <>
                {currentSlide === 0 && (
                  <SlideHook
                    data={data}
                    periodLabel={periodLabel}
                    periodStart={recap.periodStart}
                    periodEnd={recap.periodEnd}
                  />
                )}
                {currentSlide === 1 && <SlideRank data={data} />}
                {currentSlide === 2 && <SlideUsage data={data} type={recap.type} />}
                {currentSlide === 3 && (
                  <SlideRhythm
                    data={data}
                    type={recap.type}
                    periodStart={recap.periodStart}
                    periodEnd={recap.periodEnd}
                  />
                )}
                {currentSlide === 4 && (
                  <SlideShare
                    recapId={recap.id}
                    data={data}
                    type={recap.type}
                    periodStart={recap.periodStart}
                    periodEnd={recap.periodEnd}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom navigation hint */}
        <div className="absolute bottom-4 left-0 right-0 z-30 flex items-center justify-center gap-1.5">
          {Array.from({ length: totalSlides }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentSlide
                  ? "w-4 bg-accent"
                  : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        {/* Keyboard hint — desktop only */}
        <div className="absolute bottom-4 right-4 z-30 hidden sm:flex items-center gap-1 text-white/20 text-[10px] font-mono">
          <kbd className="rounded border border-white/10 px-1">&#8592;</kbd>
          <kbd className="rounded border border-white/10 px-1">&#8594;</kbd>
        </div>
      </div>
    </div>,
    document.body,
  );
}
