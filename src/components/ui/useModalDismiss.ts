"use client";

import { useEffect } from "react";

/**
 * Standard modal dismissal behavior: close on Escape and (by default)
 * lock body scroll while `active`.
 *
 * The listener re-attaches when `onClose` changes, so an inline closure
 * is fine — matching the per-modal effects this replaces.
 */
export function useModalDismiss(
  active: boolean,
  onClose: () => void,
  { lockScroll = true }: { lockScroll?: boolean } = {}
) {
  useEffect(() => {
    if (!active) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (lockScroll) document.body.style.overflow = "";
    };
  }, [active, onClose, lockScroll]);
}
