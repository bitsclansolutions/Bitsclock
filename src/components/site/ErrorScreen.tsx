import Link from "next/link";
import { Home, RotateCcw } from "lucide-react";
import { Logo } from "@/components/AppShell";
import { BackButton } from "./BackButton";

type Props = {
  code: string;
  /** Short line under the code on the brand panel. */
  kicker?: string;
  title: string;
  body: string;
  /** Optional retry handler (client error boundaries). */
  onRetry?: () => void;
  showBack?: boolean;
  detail?: string;
  /** Extra actions rendered after the defaults. */
  extra?: React.ReactNode;
  /** true = fills the viewport (public pages); false = fills the app's content area. */
  standalone?: boolean;
};

const KICKERS: Record<string, string> = {
  "403": "This door is locked.",
  "404": "Nothing on this page.",
  "500": "Something tripped.",
};

/**
 * Full-page error screen in the same two-panel style as the sign-in page: brand panel
 * with the big code on the left, the message and ways out on the right.
 */
export function ErrorScreen({ code, kicker, title, body, onRetry, showBack = true, detail, extra, standalone = true }: Props) {
  return (
    <div className={`grid overflow-hidden bg-canvas lg:grid-cols-[1fr_1.15fr] ${standalone ? "min-h-screen" : "min-h-[calc(100vh-7.5rem)] rounded-[1.25rem]"}`}>
      {/* Brand panel */}
      <div className="card-accent relative flex flex-col justify-between rounded-none p-8 sm:p-12">
        <Link href="/" className="flex items-center gap-3" aria-label="Bitsclock home">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white">
            <Logo size={30} className="text-white" />
          </span>
          <span className="text-lg font-extrabold">Bitsclock</span>
        </Link>
        <div className="py-10 lg:py-0">
          <p className="select-none text-[6.5rem] font-extrabold leading-none tracking-tighter text-white sm:text-[9rem] lg:text-[11rem]" aria-hidden="true">
            {code}
          </p>
          <p className="mt-2 text-lg font-bold text-white/85">{kicker ?? KICKERS[code] ?? "Something's not right."}</p>
        </div>
        <p className="hidden text-xs text-white/60 lg:block">© {new Date().getFullYear()} Bitsclock</p>
      </div>

      {/* Message */}
      <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-16">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">Error {code}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-600">{body}</p>
        {detail && <p className="mt-4 inline-block max-w-md rounded-xl bg-white px-3 py-2 font-mono text-xs text-ink-500 shadow-card">{detail}</p>}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-primary">
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
          )}
          <Link href="/dashboard" className={onRetry ? "btn btn-secondary" : "btn btn-primary"}>
            <Home className="h-4 w-4" /> Go to dashboard
          </Link>
          {showBack && <BackButton />}
          {extra}
        </div>
        <p className="mt-10 text-xs text-ink-400">If this keeps happening, tell your administrator what you were trying to open.</p>
      </div>
    </div>
  );
}
