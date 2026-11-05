import Link from "next/link";
import { ArrowRight, BarChart3, Clock3, DollarSign, FileSpreadsheet, FolderKanban, LayoutGrid, Play, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/AppShell";

const FEATURES = [
  { icon: Clock3, title: "One-click timer", body: "Start a timer the moment you begin a task and stop it when you're done. It keeps running in the header on every page." },
  { icon: FolderKanban, title: "Projects with teams", body: "Administrators create projects, mark them billable or not, and choose who can log time on each: everyone or selected members." },
  { icon: DollarSign, title: "Billable by project", body: "Every entry inherits its project's billing, so reports split billable and non-billable time without extra clicks." },
  { icon: BarChart3, title: "Reports that answer questions", body: "Totals, trends per day, time by project and by member for any period, filtered by member, project and billing." },
  { icon: FileSpreadsheet, title: "Export in one click", body: "Download any report as a CSV for spreadsheets or a PDF for clients and management." },
  { icon: ShieldCheck, title: "Roles you define", body: "Create roles like Manager or Team Lead, tick the permissions each gets, and assign them to members." },
];

const STEPS = [
  { n: "01", title: "Set up the workspace", body: "An administrator creates projects, defines roles and adds members." },
  { n: "02", title: "Track the work", body: "Members start timers or log hours against their projects." },
  { n: "03", title: "Report and export", body: "Managers see who is tracking now and export team reports." },
];

export function Landing({ signedIn }: { signedIn: boolean }) {
  const cta = signedIn ? { href: "/dashboard", label: "Open dashboard" } : { href: "/login", label: "Sign in" };
  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3" aria-label="Bitsclock home">
          <Logo size={44} />
          <span className="text-lg font-extrabold tracking-tight text-ink-900">Bitsclock</span>
        </Link>
        <nav className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-card md:flex" aria-label="Site">
          {[["#features", "Features"], ["#how", "How it works"], ["#roles", "Roles"]].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full px-4 py-2 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 hover:text-ink-900">{label}</a>
          ))}
        </nav>
        <Link href={cta.href} className="btn btn-dark">
          {cta.label} <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto mt-10 grid max-w-6xl items-center gap-10 lg:mt-16 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-brand-800 shadow-card">
            <span className="live-dot" /> Time tracking for teams
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl">
            Every hour, <span className="text-brand-600">on the record.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-500">
            Bitsclock is where your team starts timers, logs hours against projects and turns them into reports you can export in one click. Calm for employees, clear for managers.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={cta.href} className="btn btn-primary px-5">
              {signedIn ? <LayoutGrid className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />} {cta.label}
            </Link>
            <a href="#features" className="btn btn-secondary px-5">See what&apos;s inside</a>
          </div>
          <p className="mt-4 text-xs text-ink-400">Accounts are created by your workspace administrator.</p>
        </div>

        {/* Product mock in the dashboard's own style */}
        <div className="grid gap-4" aria-hidden="true">
          <div className="grid grid-cols-2 gap-4">
            <div className="card flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Clock3 className="h-5 w-5" /></span>
              <div><p className="text-xs text-ink-500">Today</p><p className="text-xl font-extrabold">5h 42m</p></div>
            </div>
            <div className="card-accent flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><DollarSign className="h-5 w-5" /></span>
              <div><p className="text-xs text-white/75">Billable</p><p className="text-xl font-extrabold">82%</p></div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3 rounded-2xl bg-ink-50 px-3.5 py-2.5">
              <span className="live-dot" />
              <span className="flex-1 truncate text-sm font-semibold">Design onboarding flow</span>
              <span className="tabular text-lg font-extrabold">01:24:36</span>
              <span className="rounded-xl bg-[#c7423a] px-3 py-1.5 text-xs font-bold text-white">Stop</span>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {[
                ["Fix checkout bug", "Website Redesign", "#0f62cc", "2h 10m"],
                ["Sprint planning", "Internal Tools", "#4f92ea", "45m"],
                ["Client call", "Acme Corp", "#9cc2f5", "1h 22m"],
              ].map(([t, p, c, d]) => (
                <li key={t} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="h-8 w-1 rounded-full" style={{ background: c }} />
                  <span className="flex-1 truncate font-semibold">{t}</span>
                  <span className="hidden text-xs text-ink-500 sm:inline">{p}</span>
                  <span className="delta-up">Billable</span>
                  <span className="tabular w-14 text-right font-extrabold">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto mt-20 max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Features</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900">Everything a team needs to track time, nothing it doesn&apos;t</h2>
          <p className="mt-3 text-ink-500">Built around the daily routine: start, stop, pick a project, and let the reports do the rest.</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700"><f.icon className="h-5 w-5" /></span>
              <h3 className="mt-4 text-base font-extrabold text-ink-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto mt-20 max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">How it works</p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900">Up and running in three steps</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-6">
              <span className="text-xs font-extrabold text-brand-600">{s.n}</span>
              <h3 className="mt-2 font-extrabold text-ink-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Roles */}
      <section id="roles" className="mx-auto mt-20 max-w-6xl">
        <div className="card-accent grid items-center gap-10 p-8 lg:grid-cols-2 lg:p-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">Roles &amp; permissions</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Give each person exactly the access they need</h2>
            <p className="mt-4 text-white/80">Build roles from a catalog of permissions: track own time, see everyone&apos;s time, manage projects, run team reports, export, manage members. Assign a role to each member and change it any time.</p>
          </div>
          <ul className="space-y-3">
            {[["Administrator", "Everything", true], ["Manager", "Team time, reports, projects", false], ["Employee", "Own time and reports", false]].map(([n, d, lock]) => (
              <li key={String(n)} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">{lock ? <ShieldCheck className="h-4 w-4" /> : <Users className="h-4 w-4" />}</span>
                <div><p className="text-sm font-bold">{n}</p><p className="text-xs text-white/70">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="mx-auto mt-16 flex max-w-6xl flex-col items-center justify-between gap-3 py-6 text-xs text-ink-400 sm:flex-row">
        <span className="flex items-center gap-2"><Logo size={20} /> Bitsclock © {new Date().getFullYear()}</span>
        <Link href={cta.href} className="font-bold text-brand-700 hover:underline">{cta.label}</Link>
      </footer>
    </div>
  );
}
