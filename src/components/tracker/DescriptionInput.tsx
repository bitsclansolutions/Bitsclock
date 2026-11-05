"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { api } from "@/lib/client";
import type { SuggestionDTO } from "@/app/api/time-entries/suggest/route";
import { LIMITS } from "@/lib/sanitize";
import { ProjectDot, cx } from "@/components/ui";

/**
 * Entry-bar description field with suggestions from the member's own past entries.
 * Picking one fills the description and the project it was last logged against.
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
  return (
    <div ref={wrap} className={cx("relative min-w-0", className)}>
      <input
        id={id}
        aria-label={id ? undefined : "What are you working on?"}
        aria-autocomplete="list"
        className="field w-full"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (show && e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => (h + 1) % items.length);
          } else if (show && e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h - 1 + items.length) % items.length);
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter") {
            if (show && hi >= 0) {
              e.preventDefault();
              pick(items[hi]!);
            } else if (!disabled && onSubmit) {
              onSubmit();
            }
          } else if (e.key === "Tab" && show && hi >= 0) {
            pick(items[hi]!);
          }
        }}
        placeholder={placeholder ?? "What are you working on? (optional)"}
        maxLength={LIMITS.entryDescription}
        autoComplete="off"
      />
      {show && (
        <ul role="listbox" aria-label="Suggestions from your past entries" className="fade-up absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-pop">
          {items.map((s, i) => (
            <li key={s.description}>
              <button
                type="button"
                role="option"
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
