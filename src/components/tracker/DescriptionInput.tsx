"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { usePopupOpen } from "@/lib/focus";
import { api } from "@/lib/client";
import type { SuggestionDTO } from "@/app/api/time-entries/suggest/route";
import { LIMITS } from "@/lib/sanitize";
import { ProjectDot, cx } from "@/components/ui";

/** Show "430/500" once the text gets this close to the limit. */
const COUNTER_FROM = 400;
/** A multiline box grows to at most this many lines, then scrolls. */
const MAX_LINES = 4;

/**
 * Entry description field with suggestions from the member's own past entries.
 * Picking one fills the description and the project it was last logged against.
 *
 * - Single line (entry bar): long text scrolls sideways; the full text is in the tooltip.
 * - `multiline` (editors): a box that grows to 4 lines so a long description can be read
 *   back. It stays one paragraph: Enter saves instead of adding a line, and pasted line
 *   breaks become spaces (the API stores descriptions as one line).
 * - Both show a character counter near the limit.
 */
export function DescriptionInput({
  value,
  onChange,
  onPick,
  onSubmit,
  disabled,
  className = "",
  id,
  placeholder,
  multiline = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: SuggestionDTO) => void;
  /** Called on Enter when no suggestion is highlighted. Omit inside a form to let the form submit natively. */
  onSubmit?: () => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [items, setItems] = useState<SuggestionDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Debounced lookup; the API returns only this member's descriptions.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api<{ suggestions: SuggestionDTO[] }>(`/api/time-entries/suggest?q=${encodeURIComponent(q.slice(0, LIMITS.search))}`);
        if (id !== seq.current) return;
        const exact = res.suggestions.length === 1 && res.suggestions[0]!.description.toLowerCase() === q.toLowerCase();
        setItems(exact ? [] : res.suggestions);
        setHi(-1);
      } catch {
        /* suggestions are best-effort */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (s: SuggestionDTO) => {
    onPick(s);
    setItems([]);
    setOpen(false);
  };

  const show = open && items.length > 0;
  usePopupOpen(show);
  const listId = useId();
  const counterId = useId();
  const limit = LIMITS.entryDescription;
  const showCounter = value.length >= COUNTER_FROM;

  // Multiline: grow with the text, from one line up to MAX_LINES, then scroll.
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const border = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    // scrollHeight covers text + padding; add the border, cap at MAX_LINES lines.
    const max = (px(cs.lineHeight) || 21) * MAX_LINES + px(cs.paddingTop) + px(cs.paddingBottom) + border;
    el.style.height = `${Math.min(el.scrollHeight + border, max)}px`;
  }, [value, multiline]);

  const common = {
    id,
    "aria-label": id ? undefined : "What are you working on?",
    role: "combobox",
    "aria-expanded": show,
    "aria-controls": show ? listId : undefined,
    "aria-activedescendant": show && hi >= 0 ? `${listId}-o${hi}` : undefined,
    "aria-autocomplete": "list" as const,
    "aria-describedby": showCounter ? counterId : undefined,
    // The full text on hover, for when it's longer than the box.
    title: value.length > 40 ? value : undefined,
    value,
    disabled,
    maxLength: limit,
    autoComplete: "off",
    placeholder: placeholder ?? "What are you working on? (optional)",
    onFocus: () => setOpen(true),
  };
  const onText = (v: string) => {
    // One paragraph: line breaks (typed or pasted) become spaces.
    onChange(multiline ? v.replace(/\r?\n/g, " ") : v);
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (show && e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => (h + 1) % items.length);
    } else if (show && e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === "Escape" && show) {
      // Closes the suggestions only, never the dialog around the field (R-033).
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Enter") {
      if (show && hi >= 0) {
        e.preventDefault();
        pick(items[hi]!);
      } else if (!disabled && onSubmit) {
        if (multiline) e.preventDefault();
        onSubmit();
      } else if (multiline) {
        // A textarea doesn't submit its form on Enter by itself; do what a one-line field would.
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    } else if (e.key === "Tab" && show && hi >= 0) {
      pick(items[hi]!);
    }
  };

  return (
    <div ref={wrap} className={cx("relative min-w-0", className)}>
      {multiline ? (
        <textarea {...common} ref={area} rows={1} className={cx("field block w-full resize-none overflow-y-auto py-[0.6rem] leading-[1.5]", showCounter && "pb-6")} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown} />
      ) : (
        <input {...common} className={cx("field w-full", showCounter && "pr-[4.5rem]")} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown} />
      )}
      {showCounter && (
        <span
          id={counterId}
          aria-live="polite"
          className={cx(
            "pointer-events-none absolute right-3 text-[11px] font-bold tabular",
            multiline ? "bottom-1.5" : "top-1/2 -translate-y-1/2",
            value.length >= limit ? "text-[#b5322b]" : "text-ink-400",
          )}
        >
          {value.length}/{limit}
          <span className="sr-only"> characters used</span>
        </span>
      )}
      {show && (
        <ul id={listId} role="listbox" aria-label="Suggestions from your past entries" className="fade-up absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-pop">
          {items.map((s, i) => (
            <li key={s.description} role="presentation">
              <button
                id={`${listId}-o${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === hi}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(s)}
                className={cx("flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors", i === hi ? "bg-ink-50" : "hover:bg-ink-50")}
              >
                <History className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900">{s.description}</span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-500">
                    {s.project ? (
                      <>
                        <ProjectDot color={s.project.color} /> {s.project.name}
                      </>
                    ) : (
                      "No project"
                    )}
                    <span aria-hidden>·</span> used {s.count} time{s.count === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
