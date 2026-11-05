import { Logo } from "@/components/AppShell";

/** Two-panel card used by the public auth pages (sign in, forgot password): brand panel left, form right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[920px]">
        <div className="card grid overflow-hidden lg:grid-cols-[1.1fr_1fr]">
          {/* Brand panel */}
          <div className="card-accent relative hidden min-h-[560px] flex-col justify-between gap-8 rounded-none p-10 lg:flex">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white">
                <Logo size={30} className="text-white" />
              </span>
              <span className="text-lg font-extrabold">Bitsclock</span>
            </div>
            <div>
              <h2 className="text-3xl font-extrabold leading-tight tracking-tight">
                Every hour,
                <br />
                on the record.
              </h2>
              <p className="mt-3 max-w-sm text-sm text-white/80">Timers, projects and team reports in one calm place. Start a timer the moment you begin, export the numbers when you&apos;re done.</p>
              <ul className="mt-8 space-y-2.5 text-sm text-white/85">
                {["One-click timers and manual entries", "Billable set per project, inherited by entries", "Team reports with CSV and PDF export", "Roles and permissions you define"].map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/80" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-white/60">© {new Date().getFullYear()} Bitsclock</p>
          </div>

          {/* Form */}
          <div className="p-8 sm:p-10">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Logo size={36} />
              <span className="text-lg font-extrabold text-ink-900">Bitsclock</span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Green inline notice for a completed step (password updated, code sent). */
export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-brand-900">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
