"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, RotateCcw, X } from "lucide-react";
import { initials } from "@/lib/time";
import { anyPopupOpen, initialFocus, useFocusTrap, useLatest } from "@/lib/focus";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-ink-400", className)} aria-label="Loading" />;
}

export function Avatar({ name, color, size = "md", className = "" }: { name: string; color?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const sz = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-xs";
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", sz, className)}
      style={{ background: color ?? "#0f62cc" }}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}

type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "blue" | "purple";
const tones: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-800",
  green: "bg-[#e3f1e7] text-[#1f7a3f]",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-[#fbe5e5] text-[#b5322b]",
  blue: "bg-blue-50 text-blue-800",
  purple: "bg-violet-50 text-violet-800",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold", tones[tone], className)}>{children}</span>;
}

export function RoleBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink-50 px-2.5 text-[11px] font-bold text-ink-700">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      {name}
    </span>
  );
}

export function ProjectDot({ color, className = "" }: { color?: string | null; className?: string }) {
  return <span className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: color ?? "#9aa0a9" }} aria-hidden="true" />;
}

/** Page title lives in the shell header; this row holds page actions and an optional note. */
export function PageHeader({ actions, subtitle, title }: { title?: string; subtitle?: string; actions?: React.ReactNode; eyebrow?: string }) {
  if (!actions && !subtitle) return null;
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-500">{subtitle ?? ""}</p>
      {actions && (
        <div className="flex flex-wrap items-center gap-2" aria-label={title ? `${title} actions` : undefined}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** Stat tile: round icon, label and value, with an optional mini chart on the right. */
export function Kpi({
  label,
  value,
  sub,
  icon,
  accent = false,
  chart,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
  chart?: React.ReactNode;
}) {
  return (
    <div className={cx(accent ? "card-accent" : "card", "flex items-center gap-4 px-5 py-4")}>
      {icon && (
        <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", accent ? "bg-white/15 text-white" : "bg-brand-50 text-brand-700")}>{icon}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cx("text-[13px] font-medium", accent ? "text-white/80" : "text-ink-500")}>{label}</p>
        <p className={cx("tabular text-[22px] font-extrabold leading-tight tracking-tight", accent ? "text-white" : "text-ink-900")}>{value}</p>
        {sub && <p className={cx("mt-0.5 text-xs", accent ? "text-white/70" : "text-ink-500")}>{sub}</p>}
      </div>
      {chart && <div className="h-10 w-20 shrink-0">{chart}</div>}
    </div>
  );
}

/** Tiny bar chart for stat tiles. */
export function MiniBars({ values, accent = false }: { values: number[]; accent?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-full items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className={cx("flex-1 rounded-sm", accent ? "bg-white/70" : "bg-brand-500")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

/** Tiny line chart for stat tiles. */
export function MiniLine({ values, accent = false }: { values: number[]; accent?: boolean }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${40 - (v / max) * 34 - 3}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={accent ? "rgba(255,255,255,0.85)" : "#0f62cc"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</div>}
      <p className="text-base font-bold text-ink-900">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("skeleton rounded-2xl", className)} aria-hidden="true" />;
}

/**
 * Segmented choice, built as an ARIA radio group (R-057): one tab stop (the chosen
 * option), arrow keys move and choose, and the group has a name for screen readers.
 */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled = false,
  title,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  label: string;
  size?: "sm" | "md";
  /** Read-only: shows the current choice but can't be changed (e.g. set by the project). */
  disabled?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    onChange(options[next]!.value);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div ref={ref} role="radiogroup" aria-label={disabled && title ? `${label} (${title})` : label} aria-disabled={disabled || undefined} title={title} className="seg">
      {/* Read-only: a lock says why nothing happens on click (the reason is in `title`). */}
      {disabled && (
        <span className="seg-lock" aria-hidden="true">
          <Lock className="h-3.5 w-3.5" />
        </span>
      )}
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          tabIndex={i === selectedIndex ? 0 : -1}
          onKeyDown={(e) => move(e, i)}
          onClick={() => onChange(o.value)}
          className={cx(o.value === value && "on")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a new onClose every render; keep it in a ref so the effect below runs only
  // when the dialog opens. Before, a timer ticking every second re-ran it and yanked focus
  // back to the first field (R-007).
  const onCloseRef = useLatest(onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown inside the dialog owns Escape (R-033).
      if (e.key === "Escape" && !e.defaultPrevented && !anyPopupOpen()) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (ref.current && !ref.current.contains(document.activeElement)) initialFocus(ref.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onCloseRef]);
  // Tab stays inside the dialog; focus returns to the opener when it closes (R-034).
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx("fade-up max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-pop sm:rounded-3xl", width)}>
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <div>
            <h2 id={titleId} className="text-lg font-extrabold tracking-tight text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          <button type="button" data-close onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon -mr-2 -mt-1 h-9 w-9">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-5 pt-1">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Label + control + hint/error. The hint or error is tied to the control with
 * aria-describedby, and an error also sets aria-invalid, so screen readers announce
 * them with the field (R-057).
 */
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  const noteId = useId();
  const note = error || hint;
  const control =
    note && isValidElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>(children)
      ? cloneElement(children, { "aria-describedby": noteId, ...(error ? { "aria-invalid": true } : {}) })
      : children;
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {control}
      {error ? (
        <p id={noteId} className="mt-1 text-xs font-medium text-[#b5322b]">{error}</p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A data view that failed to load (R-039): says what went wrong and offers Retry,
 * instead of leaving skeletons on screen forever.
 */
/** Password input with a show/hide eye button, same look as the sign-in form. */
export function PasswordInput({ className = "", ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={cx("field pr-11", className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function LoadError({ what, message, onRetry, className = "" }: { what: string; message?: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cx("card flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <p className="text-base font-extrabold text-ink-900">Couldn&apos;t load {what}</p>
      {message && <p className="max-w-md text-sm text-ink-600">{message}</p>}
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        <RotateCcw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl bg-[#fbe5e5] px-3.5 py-2.5 text-sm font-medium text-[#b5322b]">
      {message}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color ?? "#0f62cc" }} />
    </div>
  );
}
