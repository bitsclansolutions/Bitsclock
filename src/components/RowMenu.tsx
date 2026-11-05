"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cx } from "./ui";

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    // Focus the first enabled item for keyboard users.
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? btns[(i + 1) % btns.length] : btns[(i - 1 + btns.length) % btns.length];
    next?.focus();
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
