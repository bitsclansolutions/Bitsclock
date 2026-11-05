"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Avatar, cx } from "./ui";
import { usePopupOpen } from "@/lib/focus";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  /** Coloured dot before the label (projects). */
  color?: string | null;
  /** Initials avatar before the label (members). */
  avatar?: string;
  group?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Show the search box. Always on by default: every dropdown is searchable. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  size?: "sm" | "md";
  className?: string;
  /** Minimum popover width in px. */
  menuWidth?: number;
  align?: "left" | "right";
  disabled?: boolean;
  /** Accessible name when there is no visible label. */
  label?: string;
  id?: string;
  /** Show a "clear" (×) button next to the control when a value is chosen. */
  clearable?: boolean;
};

/**
 * Custom dropdown with search, keyboard navigation and a portal popover so it
 * never gets clipped. Used for every select in the app.
 *
 * Accessibility (R-037): the search box is an ARIA combobox and the list a listbox; the
 * highlighted option is announced through aria-activedescendant. Escape closes only the
 * list, never a dialog around it (R-033). Scrolling moves the list with its control
 * instead of closing it, so the on-screen keyboard on phones doesn't dismiss it (R-041).
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  size = "md",
  className = "",
  menuWidth = 240,
  align = "left",
  disabled,
  label,
  id,
  clearable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-o${i}`;
  usePopupOpen(open);

  const showSearch = searchable ?? true;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term) || o.hint?.toLowerCase().includes(term) || o.group?.toLowerCase().includes(term));
  }, [options, q]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // The control scrolled out of view: nothing to anchor to any more.
    if (r.bottom < 0 || r.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const width = Math.max(r.width, menuWidth);
    const estH = Math.min(filtered.length * 38 + (showSearch ? 56 : 12), 340);
    const up = r.bottom + estH > window.innerHeight - 12 && r.top > estH;
    const left = align === "right" ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, width, up });
  }, [menuWidth, filtered.length, showSearch, align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    // Without a search box, the list itself takes focus so arrow keys and screen readers work.
    if (!showSearch) requestAnimationFrame(() => listRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place, showSearch]);

  const openMenu = () => {
    if (disabled) return;
    setQ("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const choose = (o: SelectOption) => {
    if (o.disabled) return;
    onChange(o.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      // Handled here: the dialog around this dropdown must not close too (R-033).
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home" || e.key === "End") {
      if (showSearch && e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o) choose(o);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const sz = size === "sm" ? "h-[34px] px-3 text-[13px] rounded-full gap-1.5" : "h-[42px] px-3.5 text-sm rounded-[0.875rem] gap-2";
  const showClear = clearable && selected && !disabled;
  const activeId = open && filtered[active] ? optionId(active) : undefined;

  return (
    <>
      <span className={cx("relative inline-flex min-w-0", !/\bw-/.test(className) && "w-full", className)}>
        <button
          ref={btnRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={label}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKey}
          className={cx(
            "inline-flex w-full min-w-0 cursor-pointer items-center border border-ink-900 bg-white text-left font-semibold text-ink-900 transition-colors",
            // Focus/open edge drawn inside the box (border + 1px inset ring), like .field.
            "hover:bg-ink-50 focus:outline-none focus-visible:border-brand-600 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-600",
            open && "border-brand-600 ring-1 ring-inset ring-brand-600",
            disabled && "cursor-not-allowed text-ink-500",
            showClear && "pr-9",
            sz,
          )}
        >
          {selected?.color !== undefined && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: selected.color ?? "#94a3b8" }} aria-hidden="true" />}
          {selected?.avatar !== undefined && <Avatar name={selected.avatar} size="sm" className={size === "sm" ? "!h-5 !w-5 !text-[9px]" : "!h-6 !w-6 !text-[10px]"} />}
          <span className={cx("min-w-0 flex-1 truncate", !selected && "font-normal text-ink-500")}>{selected ? selected.label : placeholder}</span>
          {!showClear && <ChevronDown className={cx("shrink-0 text-ink-500 transition-transform", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4", open && "rotate-180")} aria-hidden="true" />}
        </button>
        {showClear && (
          // A sibling, not nested in the trigger: interactive elements can't contain each other (R-037).
          <button
            type="button"
            aria-label={`Clear ${label ?? "selection"}`}
            onClick={() => {
              onChange("");
              btnRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fade-up fixed z-50 flex flex-col overflow-hidden rounded-2xl bg-white shadow-pop"
            style={{ top: pos.top, left: pos.left, width: pos.width, transform: pos.up ? "translateY(-100%)" : undefined, maxHeight: 340 }}
            onKeyDown={onKey}
          >
            {showSearch && (
              <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={label ? `${label}: ${searchPlaceholder}` : searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500"
                />
                {q && (
                  <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="rounded p-0.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label}
              tabIndex={-1}
              aria-activedescendant={showSearch ? undefined : activeId}
              className="overflow-y-auto p-1 focus:outline-none"
            >
              {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-500">{emptyText}</p>}
              {filtered.map((o, i) => {
                const showGroup = o.group && (i === 0 || filtered[i - 1]!.group !== o.group);
                const isSel = o.value === value;
                return (
                  <div key={o.value + i} role="presentation">
                    {showGroup && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500" role="presentation">{o.group}</p>}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      data-index={i}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cx(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        o.disabled && "cursor-not-allowed opacity-50",
                        i === active ? "bg-ink-100 text-ink-900 outline outline-2 -outline-offset-2 outline-brand-600/40" : "text-ink-700",
                        isSel && "font-semibold text-brand-800",
                      )}
                    >
                      {o.color !== undefined && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color ?? "#94a3b8" }} aria-hidden="true" />}
                      {o.avatar !== undefined && <Avatar name={o.avatar} size="sm" className="!h-6 !w-6 !text-[10px]" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-xs font-normal text-ink-500">{o.hint}</span>}
                      </span>
                      {isSel && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
