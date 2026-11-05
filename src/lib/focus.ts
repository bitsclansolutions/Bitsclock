"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard and focus helpers shared by modals, the mobile drawer, the search overlay,
 * dropdowns and menus (R-007, R-033, R-034).
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * While `active`, Tab and Shift+Tab cycle inside `ref` instead of escaping to the page
 * behind it; when it ends, focus returns to whatever had it before (the opener).
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const items = focusables(ref.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Give focus back to the opener if it's still on the page.
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/**
 * The element a dialog should focus first: anything marked autofocus, else the first
 * text-like field, else the first control that isn't the close button (R-007).
 */
export function initialFocus(root: HTMLElement) {
  return (
    root.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
    root.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled])') ??
    root.querySelector<HTMLElement>("select:not([disabled]), button:not([disabled]):not([data-close])")
  );
}

// Open popups (dropdowns, menus, suggestion lists). While any is open, Escape belongs to it,
// not to the dialog around it, so a dialog never closes and loses input on that Escape (R-033).
let openPopups = 0;
export const anyPopupOpen = () => openPopups > 0;

/** Register a popup as open while `open` is true. */
export function usePopupOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openPopups++;
    return () => {
      // Released after the current key event, so the dialog's own Escape handler still sees it as open.
      setTimeout(() => {
        openPopups = Math.max(0, openPopups - 1);
      }, 0);
    };
  }, [open]);
}

/** A ref that always holds the latest value, so effects can call it without re-running (R-007). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
