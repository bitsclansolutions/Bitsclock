"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cx } from "./ui";
import { usePopupOpen } from "@/lib/focus";

export type RowMenuItem =
  | { divider: true }
  | {
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
    };

type Props = {
  items: RowMenuItem[];
  label?: string;
  align?: "right" | "left";
  className?: string;
};

/**
 * Three-dots menu for table rows and cards. The popover is rendered in a portal
 * with fixed positioning so it is never clipped by an overflow-x-auto table.
 */
export function RowMenu({ items, label = "More actions", align = "right", className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  /**
   * Position the popover next to the button and keep it fully inside the viewport:
   * below the button when there is room, above it otherwise, and never past the
   * left or right edge. Uses the real menu size once it has rendered.
   */
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 12;
    const gap = 6;
    const mh = menuRef.current?.offsetHeight ?? Math.min(items.length * 40 + 12, 320);
    const mw = menuRef.current?.offsetWidth ?? 176;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let top = r.bottom + gap;
    if (top + mh > vh - margin) {
      top = r.top - gap - mh >= margin ? r.top - gap - mh : Math.max(margin, vh - margin - mh);
    }
    let left = align === "right" ? r.right - mw : r.left;
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - mw));
    setPos({ top, left });
  }, [items.length, align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Measure again once the menu exists in the DOM so the real height/width is used.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  usePopupOpen(open);
  const closeToButton = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  // Focus the first item once the portal has been positioned and actually rendered (R-009).
  // Before, this ran while the menu didn't exist yet, so keyboard users never reached it.
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, placed]);

  const items_ = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const btns = items_();
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? btns[(i + 1) % btns.length] : btns[(i - 1 + btns.length) % btns.length];
      next?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? btns[0] : btns[btns.length - 1])?.focus();
    } else if (e.key === "Escape") {
      // The menu owns this Escape; a dialog around it stays open (R-033).
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
    } else if (e.key === "Tab") {
      e.preventDefault();
      closeToButton();
    }
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className={cx("btn btn-ghost btn-icon h-8 w-8 text-ink-500 hover:text-ink-900", open && "bg-ink-100 text-ink-900", className)}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            className="fade-up fixed z-50 min-w-[11rem] max-h-[min(70vh,24rem)] overflow-y-auto rounded-2xl bg-white p-1.5 shadow-pop"
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((it, i) =>
              "divider" in it ? (
                <div key={i} className="my-1 border-t border-ink-100" role="separator" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={it.disabled}
                  title={it.hint}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={cx(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    it.danger ? "text-red-600 hover:bg-red-50 focus:bg-red-50" : "text-ink-700 hover:bg-ink-50 focus:bg-ink-50 hover:text-ink-900",
                  )}
                >
                  {it.icon && <span className={cx("shrink-0", it.danger ? "text-red-500" : "text-ink-400")}>{it.icon}</span>}
                  <span className="flex-1">{it.label}</span>
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
