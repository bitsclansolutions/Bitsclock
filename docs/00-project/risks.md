# Risk register

Source of findings: `docs/05-quality/audits/2026-11-05-audit.md`.
R-001 and R-002 were decided by the owner. Everything from R-003 on was decided by Claude on 2026-11-05 at the owner's request ("decide on behalf of me but record every decision"); the owner can override any line.

## Fix waves
- **Wave 1 — before 2026-11-19 (Prisma deadline):** Node update, test harness, H1, H4, H5, M8, M10, then Prisma 7 + migration baseline.
- **Wave 2 — before real users:** H3, H6, H7, H8, H9, D-005 rules, D-006 constraints, M5, M9 check, M18, M21, M32.
- **Wave 3 — first month after launch:** remaining Mediums.
- **Wave 4 — as convenient:** Lows.

## High
- [ ] R-001 [high] [security] Delegated users.manage / roles.manage escalate to Administrator (H1). Decision (owner): fix per D-001. Wave 1.
- [x] R-002 [withdrawn] [compliance] Data hosted outside JMTS-approved ecosystems (H2). Decision (owner): withdrawn — Bitsclock is separate from JMTS and holds no JMTS data. Reopen if JMTS data is ever stored.
- [ ] R-003 [high] [scale] Detailed report/export capped at 2,000 rows silently (H3). Decision: fix per D-002. Wave 2.
- [ ] R-004 [high] [reliability] Security resets are multi-write without a transaction (H4). Decision: fix per D-003. Wave 1.
- [ ] R-005 [high] [security] Seed creates demo users with in-source passwords (H5). Decision: fix — seed refuses demo users unless `SEED_DEMO=1` and not production; `SEED_ADMIN_PASSWORD` required with no fallback; separate dev and prod databases; delete `@bitsclock.com` demo users from any database that will hold real data before go-live. Wave 1. Owner answer 2026-11-05: all seeded accounts except the admin will be deleted before go-live. Remaining action: if the admin was created with the in-source fallback password, change it before go-live.
- [ ] R-006 [high] [scale] Per-IP login limit locks out an office NAT (H6). Decision: fix — per-IP limits for login/refresh read from env (default 300 per 15 min); per-account limit stays 8/15 min but is keyed account+IP, with a looser account-only cap of 50/15 min (also fixes L5); fix M2. Wave 2.
- [ ] R-007 [high] [ux] Modals pull focus back on every re-render (H7). Decision: fix — `onClose` kept in a ref, focus effect runs on `[open]` only, focus goes to `[autofocus]` or the first text input, and focus is restored to the opener on close. Wave 2.
- [ ] R-008 [high] [a11y] Focus indicator nearly invisible (H8). Decision: fix — 2px brand-600 ring with a 2px white gap on all fields, selects, search and buttons (`:focus-visible`), ≥3:1 contrast. Wave 2.
- [ ] R-009 [high] [a11y] Row "⋮" menus likely not keyboard-usable (H9). Decision: verify manually, then fix — focus the first item after the portal positions, ArrowDown/Enter on the trigger opens, Tab/Esc closes and returns focus. Wave 2.
- [ ] R-010 [high] [deps] Prisma 6 out of support 2026-11-19; Node 24.19 missing security release (H10). Decision: fix per D-008. Wave 1. Open question: Supabase Postgres major version — owner doesn't know yet (2026-11-05); must be checked before 2026-11-12 (PG14 EOL).
- [ ] R-011 [high] [tests] No tests, runner or CI (H11). Decision: fix per D-007. Wave 1 (harness and first tests), growing every wave.

## Medium
- [ ] R-012 [M1] Refresh rotation race signs users out. Decision: compare-and-swap rotation per D-003. Wave 1.
- [ ] R-013 [M2] In-memory rate-limit sweep uses the wrong window. Decision: per-bucket window per D-004. Wave 2.
- [ ] R-014 [M3] Running timers bypass the 24 h cap. Decision: auto-stop at 24 h with `autoStopped` flag per D-005. Wave 2.
- [ ] R-015 [M5] Idempotency store issues. Decision: never persist secrets (replay returns "already created; reset the password to get a new one" without `tempPassword`); key bound to user + method + path + body hash; pending rows older than 60 s are treated as failed and can be retried; client creates one key per form submission and disables the button while pending. Wave 2.
- [ ] R-016 [M6] Fire-and-forget promises after the response. Decision: use `after()` per D-004. Wave 3.
- [ ] R-017 [M7] Per-instance cache invalidation and stale writes. Decision: Redis required in prod + tag-version check per D-004. Wave 3.
- [ ] R-018 [M8] Session cache stores passwordHash. Decision: select only needed fields per D-004. Wave 1.
- [ ] R-019 [M9] Last-admin guard is check-then-act. Decision: resolved by D-001 — the admin account can't be demoted, deactivated or deleted through any route, so there's no "last admin" race. Verify when implementing D-001. Wave 1.
- [ ] R-020 [M10] CSV formula injection. Decision: prefix `'` to any cell starting with `= + - @`, tab or carriage return. Wave 1.
- [ ] R-021 [M11] DB doesn't enforce invariants; user delete cascades time history. Decision: per D-006. Wave 2.
- [ ] R-022 [M12] No error tracking, health check, logs or audit trail. Decision: `AuditLog` table for privileged actions (role/user changes, approvals, resets, lock-date changes, break-glass); `/api/health` (DB + Redis); structured JSON logs; host logs for now, add an error tracker (e.g. Sentry) when the first real users arrive. Wave 2 (AuditLog with D-001), rest Wave 3.
- [ ] R-023 [M13] Billed history editable; employees self-set billable. Decision: lock date + billable rules per D-005. Wave 2.
- [ ] R-024 [M14] Refresh-token reuse not detected. Decision: per D-003. Wave 1.
- [ ] R-025 [M15] Entry list capped at 2,000 with no paging. Decision: cursor pagination (keyset, 100 per page, "Load more") with `hasMore`. Wave 3.
- [ ] R-026 [M16] `db push`, no migration history. Decision: `prisma migrate` baseline per D-006. Wave 1 (with Prisma 7).
- [ ] R-027 [M17] Bulk insert slow and holds the pool. Decision: validate all rows in memory first, one overlap query for the whole range, one `createMany`, max 500 rows per request, one advisory lock. Wave 3.
- [ ] R-028 [M18] Prisma retry extension retries writes and pool timeouts. Decision: retry only reads, and only on connection errors before the query was sent; never retry writes or P2024. Wave 2.
- [ ] R-029 [M19] `SUM(...)::int` overflow. Decision: `::float8` per D-006. Wave 2.
- [ ] R-030 [M20] All-time dashboard aggregates; global `entries` cache tag. Decision: per-user cache tags; dashboard aggregates bounded to the selected period; running-timer lookup uses the D-006 partial index. Wave 3.
- [ ] R-031 [M21] Report filter logic duplicated four times and drifting. Decision: one shared `buildEntryFilter()` used by reports, timesheet, entries and export; timesheet honours `billable`. Wave 2.
- [ ] R-032 [M22] CSV download bypasses refresh-on-401. Decision: fetch-based download per D-002. Wave 2.
- [ ] R-033 [M23] Esc in a dropdown closes the whole modal. Decision: open dropdowns handle Esc and stop propagation; the modal closes only when no popup is open. Wave 3.
- [ ] R-034 [M24] Drawer, modals and search don't trap or restore focus. Decision: one shared `useFocusTrap` hook used by all three. Wave 3.
- [ ] R-035 [M25] Low text contrast. Decision: darken ink-500 and ink-400 tokens to ≥4.5:1 for text (≥3:1 for icons). Wave 3.
- [ ] R-036 [M26] Hidden scrollbars hide table overflow. Decision: visible horizontal scrollbars on overflow tables plus an edge shadow hint. Wave 3.
- [ ] R-037 [M27] Select and search don't announce the active option. Decision: ARIA combobox/listbox pattern with `aria-activedescendant`; clear button moved out of the trigger. Wave 3.
- [ ] R-038 [M28] Expired session loses form input silently. Decision: save open form drafts to sessionStorage, redirect to login with "Your session expired" message, return to the same page and restore the draft. Wave 3.
- [ ] R-039 [M29] Load failures leave skeletons forever. Decision: shared error state with a Retry button on every data view. Wave 3.
- [ ] R-040 [M30] Long-timer alert points to an impossible action. Decision: new copy + "Stop and edit" button per D-005. Wave 2.
- [ ] R-041 [M31] Mobile layout issues. Decision: `h-dvh`, week calendar switches to a day list under 480 px, Select stays open on scroll. Wave 3.
- [ ] R-042 [M32] nodemailer 7 with 20 advisories. Decision: upgrade per D-008. Wave 2.

## Low
- [ ] R-043 [L1] Reset-code attempt cap raceable. Decision: atomic increment + conditional consume per D-003. Wave 1.
- [ ] R-044 [L2] Forgot-password timing reveals accounts. Decision: respond immediately for every request and send mail in `after()`. Wave 3.
- [ ] R-045 [L3] `clientIp` trusts client-controlled X-Forwarded-For. Decision: read the host platform's trusted client-IP header (configured per host via env), fall back to the right-most X-Forwarded-For entry. Wave 2 (with R-006).
- [ ] R-046 [L4] Redirect loop when tokenVersion is stale. Decision: the app layout clears session cookies before redirecting to login. Wave 3.
- [ ] R-047 [L5] Anyone can lock out a known admin for 15 min. Decision: account+IP keying per R-006. Wave 2.
- [x] R-048 [L6] CSP allows `'unsafe-inline'` scripts. Decision: **accepted for now** — no user-supplied HTML and no third-party scripts, other headers are strong. Revisit when adding any third-party script or rich-text content (then nonce CSP via proxy.ts).
- [ ] R-049 [L7] Email failures only logged; forgot blocks on slow SMTP. Decision: `after()` (R-044) + AuditLog/logging (R-022); admin sees "invite email failed, resend" on the user row. Wave 3.
- [ ] R-050 [L8] L1 cache unbounded. Decision: LRU per D-004. Wave 3.
- [ ] R-051 [L9] Refresh sessions never pruned. Decision: prune expired and revoked sessions for the user on each login (no cron needed). Wave 3.
- [ ] R-052 [L10] Timesheet can show "1:60". Decision: reuse `fmtHM`. Wave 4.
- [ ] R-053 [L11] Dead try/catch and string-sorted times in bulk. Decision: remove with R-027. Wave 3.
- [ ] R-054 [L12] Mutable module globals in time.ts; inline Date.now/Math.random. Decision: pass settings explicitly and inject a clock where tests need it, as tests reach those files. Wave 4.
- [ ] R-055 [L13] DateTimeFormat built per CSV row. Decision: per D-002. Wave 2.
- [ ] R-056 [L14] Project delete race nulls entries' project. Decision: `onDelete: Restrict` + archive per D-006. Wave 2.
- [ ] R-057 [L15] Accessibility batch (errors not tied to fields, unlabelled Seg groups, dead bell, mouse-only calendar add, toasts, nested role card, no nav/skip link, chart text alternatives, "Settings" copy). Decision: fix as one accessibility pass; remove the bell until notifications exist. Wave 4.
- [ ] R-058 [L16] Dependency hygiene. Decision: per D-008; also fix the outdated `sanitize.ts:6` comment. Wave 2.
- [ ] R-059 [L17] Very fresh versions adopted. Decision: 7-day cooldown + `npm ci` per D-008. Ongoing.

## Added from /security-audit run-1 (C:/Users/HP/security-audit-skill/Bitsclock/run-1, 2026-11-05)
Cross-check notes: that audit confirmed H1 (users.manage, high; roles.manage, medium), M9 last-admin race, M10 CSV injection and L1 reset-code race by execution (in-memory Prisma stand-in, not real Postgres). All are already covered above; D-001 resolves both escalation findings and the last-admin race. Its seed lead names the published admin password, which strengthens R-005: check the admin's hash against it (read-only bcrypt compare) or just change the password. Items below are new. Decisions by Claude (delegated), code verified 2026-11-05.

- [ ] R-060 [low] [security] Sign-out-everywhere (`auth/logout/route.ts:9-12`) and single-device sign-out (`auth/sessions/[id]/route.ts`) revoke refresh rows but leave access tokens valid up to 15 min. Decision: "everywhere" bumps tokenVersion in the same transaction as the revoke (consistent with D-003); access JWTs carry the session id (`sid`) and the session check rejects a revoked sid, which covers single-device sign-out. Wave 2.
- [ ] R-061 [low] [integrity] Removed or archived project still gains billable hours: `entries.ts:267` checks project access only when the project changes; edits and `stopTimer` skip it. Decision: re-run `assertProjectUsable` whenever an edit increases duration or turns billable on, and in `stopTimer` (alongside D-005's 24 h rule). Wave 2.
- [ ] R-062 [medium] [security] Email links fall back to the request's `x-forwarded-host`/`host` when `APP_URL` is unset (`mail.ts:39-51`), so a forged header could point reset/invite links at another host. Decision: production requires `APP_URL` (fatal config error otherwise, same check as D-004's Redis rule); `appUrl()` never reads request headers in production. Wave 1. Check now: `APP_URL` set in every deployed environment.
- [ ] R-063 [low] [hardening] `safeNextPath` accepts `/.//x` and `/%2e//x`. Decision: decode once, reject any path with `//`, backslashes or dot segments. Wave 3.
- [ ] R-064 [low] [hardening] Secure cookie flag keyed on `NODE_ENV` (`auth.ts:69`). Decision: always Secure except plain-http localhost. Wave 3.
- [ ] R-065 [low] [security] Pending reset codes survive admin reset, email change and deactivation. Decision: delete them inside the D-003 transaction. Wave 1 (with R-004).
- [ ] R-066 [low] [integrity] Dashboard cache isn't invalidated by role edits; dashboard range uncapped. Decision: add the `roles` tag to dashboard and entries caches; cap the range at 400 days (with R-030). Wave 3.
- [ ] R-067 [low] [abuse] No per-user rate limit on authenticated routes; `parseBody` buffers the body before its size check. Decision: per-user bucket (reads 300/min, writes 60/min, env-configurable); reject on `Content-Length` first and count bytes while reading. Wave 3.
- [x] R-068 [low] Idempotency rows not deleted on user hard delete. Decision: resolved by D-006 (users are never hard-deleted).
- [ ] R-070 [high] [security] The kept admin account may still use the seed's published default password. Decision (delegated): change the admin password before go-live regardless of whether it matches, and immediately if the app is reachable online. Wave 1, first item.
- [ ] R-071 [deps] Supabase Postgres major version unknown. Decision (delegated): check it (Dashboard → Project Settings → Infrastructure, or `select version();`) before 2026-11-12; if below 15, upgrade to the latest version Supabase offers from that page. Wave 1.
- [ ] R-069 [test gap] Race findings (M9, L1, M1) were only reproduced on an in-memory stand-in. Decision: confirm and guard them with real-Postgres concurrency tests in the D-007 harness. Wave 1.
