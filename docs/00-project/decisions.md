# Decisions

> D-002 onward were decided by Claude on 2026-11-05 at the owner's explicit request ("decide on behalf of me but record every decision"). Each one is open for the owner to override; reasoning is Claude's, marked as such. Smaller decisions live per finding in `risks.md`.

## D-001: Single Administrator with break-glass recovery and delegated deactivation
- Date: 2026-11-05
- Status: accepted
- Type: 1
- Context: Audit 2026-11-05 finding H1. `users.manage` / `roles.manage` could be granted to any custom role, and the server checked only the caller's permission, never the target. Any holder could become Administrator in one request (`roles/[id]/route.ts:49-51`, `users/route.ts:42-52`, `users/[id]/route.ts:28-47`, `roles/[id]/route.ts:7-34`, `users/[id]/reset-password/route.ts:20-26`).
- Options considered:
  - A. Exactly one admin; only the admin manages users and roles; other roles submit requests the admin approves. Simplest, but no recovery if the admin is lost and offboarding waits on the admin.
  - B. A plus an out-of-band break-glass recovery script and a delegable `users.deactivate` permission.
  - C. Delegated user management under a privilege ceiling (non-admins act only on non-admin users with roles that are subsets of their own), up to two admins. No bottleneck, but the most rules to get right and test.
- Decision: B.
  - Exactly one Administrator. No route may assign the Administrator role (create, update, role-delete reassignment). Enforced on the server.
  - `users.manage` and `roles.manage` become admin-only and can no longer be granted to roles; a migration strips them from existing non-admin roles.
  - New `users.request` permission: creates a pending `MemberRequest` (name, email, job title, requested non-admin role). The admin approves (re-validating email uniqueness and role) or rejects on the Team page. Approval creates the user and sends the invite.
  - New `users.deactivate` permission: deactivates non-admin users other than oneself. Revokes sessions and stops running timers, the same as admin deactivation.
  - Break-glass script (`npm run admin:recover`), run only by JMTS IT where database access already exists. Never an HTTP route. Resets the admin's email and password, revokes the admin's sessions, and writes an audit record.
- My reasoning (in my words): "B, it keeps one admin but survives losing them."
- Tradeoffs accepted: The admin is the bottleneck for onboarding and role changes. One extra permission and one script to maintain.
- Consequences: Easier: one authorization rule for every privileged action ("is the caller the admin?"); H1 removed at the root; offboarding doesn't wait on the admin; admin loss is recoverable. Harder: onboarding needs an approval step and a new MemberRequest table and UI.
- Revisit when: Onboarding requests regularly wait more than one working day for approval, or JMTS grows to multiple departments that need their own user administrators (then reconsider option C).

## D-002: Complete, streamed, verified CSV export; screen and PDF labelled when capped
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 2
- Context: Audit H3. Detailed report rows and CSV export stop at 2,000 (`reports.ts:68,131`, `export/route.ts:15`) while totals count everything. Owner requirement: exports must contain every entry (billing).
- Options considered: A. Remove the cap, build CSV in memory (fails on large ranges). B. Stream with keyset chunks and verify row count client-side. C. Background export job with stored file (heavy).
- Decision: B.
  - CSV has no row cap. Reads chunks of 1,000 by keyset `(startTime desc, id desc)`, each a separate short query, written straight to the response. Bypasses the report cache. One `Intl.DateTimeFormat` per export (L13). 400-day range limit stays.
  - Server sends the expected row count in a response header (from the same SQL count as totals). Client downloads through `fetch` (uses refresh-on-401, fixes M22), compares counts, and refuses to save a short file ("Export incomplete, please retry").
  - On-screen detailed list keeps the 2,000 cap with a banner "Showing 2,000 of N entries. Export CSV for the full list." The API returns `total` and `truncated`.
  - PDF above 2,000 rows offers summary only and points to CSV.
- Claude's reasoning: complete at any size with flat memory, and a failure mid-stream can't silently produce a short billing file.
- Tradeoffs accepted: no snapshot across chunks; an entry edited during an export can be missed or duplicated. Acceptable because billing exports cover past periods, which D-005 locks.
- Consequences: easier: exports scale with data. Harder: the export route is no longer a simple cached JSON-to-CSV call.
- Revisit when: a single export regularly exceeds the host's request time limit (then option C), or exact snapshot consistency becomes a requirement (wrap chunks in one REPEATABLE READ read-only transaction).

## D-003: Security resets are atomic, and any tokenVersion bump also kills refresh sessions
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 1 (schema change on sessions)
- Context: Audit H4, M1, M14, L1. Password reset, admin reset, user edit and password change do separate writes; a failure after the password write leaves refresh sessions alive. Refresh rotation is an unconditional update (a race signs users out); token reuse isn't detected.
- Options considered: A. Wrap each flow in one transaction only. B. A plus refresh sessions remember the user's tokenVersion at issue, so one tokenVersion bump invalidates everything. C. A separate `sessionsValidAfter` timestamp on User.
- Decision: B.
  - Each security flow runs in one `prisma.$transaction`: user update (password + tokenVersion++), `refreshSession.updateMany({revokedAt})`, and the reset code consumed with `updateMany({where:{id, usedAt:null}})`, aborting if count is 0 (fixes the double-submit race and L1).
  - New `RefreshSession.tokenVersion` column; refresh rejects a session whose tokenVersion differs from the user's.
  - Rotation is compare-and-swap: `updateMany({where:{id, tokenHash: presentedHash}})`; count 0 means another tab rotated first, so fall back to the grace-window check (M1).
  - An old token presented after the grace window revokes that session (reuse detection, M14). The reset-attempt counter increments atomically (L1).
- Claude's reasoning: transactions make each flow all-or-nothing; the tokenVersion link is defense in depth, so any future code path that bumps tokenVersion is automatically safe.
- Tradeoffs accepted: one new column and a migration.
- Consequences: easier: one rule ("bump tokenVersion") ends every session.
- Revisit when: sessions move to a different store.

## D-004: Assume multiple server instances in production; Redis required in production
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 1
- Context: Audit P4, M2, M6, M7, M8, L8. Cache invalidation, rate-limit buckets, the 60 s session cache and post-response promises assume one process. The planned host is Vercel (serverless, many instances).
- Options considered: A. Single instance, memory only. B. Multi-instance with shared Redis (Upstash, already wired in `kv.ts`). C. Drop caching entirely.
- Decision: B.
  - Production reports a fatal configuration error if the Redis env vars are missing. Memory fallback is for local dev only.
  - Cache loaders check a tag version before writing, so an in-flight load can't write stale data after invalidation (M7). Deactivation invalidates the session cache through Redis.
  - Work after the response (cache INCR, mail, prune) uses Next's `after()`; confirm its API in `node_modules/next/dist/docs/` before coding, per AGENTS.md (M6).
  - In-memory rate-limit buckets store their own window and the sweep uses it (M2). The L1 cache gets a max-entries LRU and drops expired entries (L8).
  - The session cache stores only needed fields, never `passwordHash` (M8).
- Claude's reasoning: matches the planned host; Redis is already integrated, so the cost is configuration, not code.
- Tradeoffs accepted: Upstash becomes a production dependency; a Redis outage degrades caching and rate limiting.
- Revisit when: hosting moves to a single long-running instance.

## D-005: Business rules for long timers, locked periods and billable
- Date: 2026-11-05
- Status: accepted (delegated) — product decision; owner should confirm
- Type: 1 (affects billing data)
- Context: Audit M3, M13. Running timers bypass the 24 h cap; anyone can edit history back to 2000; employees can set billable on non-billable work.
- Options considered: timers: reject the stop (user stuck), cap silently, or auto-stop and flag. History: no lock, lock by age, or admin-set lock date. Billable: free, project default only, or default with manager override.
- Decision:
  - Timers never exceed 24 h. On any read, stop or start-move, a timer running longer is closed at start + 24 h and marked `autoStopped = true`. The UI shows an "Auto-stopped, please check" badge; the long-timer alert offers "Stop and edit" (M30). Reports can filter auto-stopped entries. Deactivation auto-stop follows the same rule.
  - Locked periods: the admin sets a workspace lock date. Entries before it can't be created, edited or deleted except by the admin; the server enforces it on every entry write path, bulk included.
  - Billable follows the project/activity default. Only `time.manage_all` holders can override it.
- Claude's reasoning: auto-stop plus a flag avoids both overbilling and stuck users; a single lock date is the simplest model that protects invoiced data.
- Tradeoffs accepted: an auto-stopped entry may be wrong until the user fixes it; employees can't mark their own time billable.
- Consequences: new columns (`autoStopped`, workspace `lockDate`) and checks on all entry write paths.
- Revisit when: clients need per-project lock dates or a timesheet approval workflow.

## D-006: The database enforces core invariants; schema changes go through migrations
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 1
- Context: Audit P3, M11, M16, M19, M20, L14. Invariants live only in app code; `TimeEntry.user onDelete: Cascade`; `db push` with no history; `SUM(...)::int` overflow.
- Decision:
  - Move to `prisma migrate`: baseline the current schema as the first migration, together with the Prisma 7 upgrade (D-008). No `db push` outside local prototyping.
  - `TimeEntry.user` and `TimeEntry.project` become `onDelete: Restrict`. Users are deactivated, never deleted; projects with entries are archived (L14). (Amended by D-011: members can be soft-deleted; the row itself is still never removed.)
  - Constraints: `CHECK (endTime IS NULL OR endTime > startTime)`; partial unique index "one running timer per user" (`WHERE endTime IS NULL`, which also speeds the running-timer lookup in M20); `kind` and `memberMode` become enums.
  - Aggregates cast with `::float8` instead of `::int`.
- Claude's reasoning: the database is the last defense against races and future bugs; migrations give history and rollback.
- Tradeoffs accepted: existing rows must be checked against the new constraints first (fix or report violations before migrating).
- Revisit when: new features add invariants.

## D-007: Test strategy — Vitest + Playwright against a dedicated test database
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 2
- Context: Audit H11. No tests, runner or CI.
- Decision:
  - Vitest (node environment) for lib units and route-handler integration tests; Playwright for an 8-step smoke suite.
  - A dedicated test Postgres with synthetic data only (local container or a separate Supabase project), never the dev or prod database. Truncate between files, unique-user factories, serial files. Mock `next/headers` cookies, raise rate limits in the test env, fake only `Date`.
  - The harness is built first, before the Prisma 7 upgrade, starting with the audit's 10-test plan (H1 escalation and overlap/24 h cases first).
  - CI runs typecheck, lint and tests on every push once the project is under git.
- Claude's reasoning: the Prisma major upgrade and the security fixes need a safety net before they land.
- Revisit when: the suite takes longer than ~5 minutes (per-worker databases).

## D-008: Dependency upgrades and supply-chain policy
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 2
- Context: Audit H10, M32, L16, L17. Sources fetched 2026-11-05: prisma.io/docs/orm/release-status, nodejs.org/en/blog/vulnerability/october-2026-security-releases.
- Decision:
  - Node: latest 24.x LTS (≥ 24.22.1) locally and on the host; `"engines": {"node": ">=24.22.1 <25"}`; apply the 2026-11-11 Node security release when published.
  - Prisma 6 → 7 as its own step before 2026-11-19, after the test harness (D-007), following the official upgrade guide; test `$queryRaw` in reports.ts and advisory locks in entries.ts. Clears deepmerge-ts.
  - nodemailer → 10.3.1, @types/nodemailer → 8; retest forgot, reset and invite emails.
  - react/react-dom 19.3.1, @types/node ^24. minimatch dev chain via `overrides`; never accept npm audit's eslint-config-next downgrade. TypeScript 7 / ESLint 10 deferred (no security reason).
  - Supply chain: install with `npm ci`; review lockfile diffs; don't adopt releases younger than 7 days except security fixes; `npm audit` in CI.
  - Action: confirm the Supabase Postgres major version; if 14, upgrade before 2026-11-12.
- Revisit when: Prisma 8 GA, Node 26 adoption, or any KEV-listed advisory in the tree.

## D-009: Audit method — two independent audits plus coverage matrices
- Date: 2026-11-05
- Status: accepted (delegated)
- Type: 2
- Context: /security-audit run-1 found 10 items /me:audit missed (R-060..R-069), while /me:audit found many it missed (H3, H4, H6, UX, tests, dependencies). The misses came from method: single static pass per specialist, checking that known protections exist instead of enumerating every path, no executed payloads, and config assumed from local `.env`.
- Decision:
  - Before each release, run both audits: /me:audit for breadth (scale, reliability, UX, tests, deps) and /security-audit for depth (executed, critic-driven security hunting). Merge into risks.md.
  - Every audit brief includes coverage matrices the reviewers must fill: (1) every invariant × every write path that can affect it (entries: create, edit, bulk, start, stop, start-move, deactivation); (2) every way a session can end × whether access and refresh tokens both die; (3) every value read from the request (headers, host, query) × whether it can reach a link, a cookie or a redirect.
  - Review "looks good" items adversarially (try encoded and edge inputs) before listing them as strengths.
  - Assume production config may differ from local `.env`; list every env-dependent behaviour.
- Claude's reasoning: different methods catch different bugs; matrices turn "did anyone think of it" into "is every cell filled".
- Revisit when: a later audit finds a miss that a matrix should have caught (add a matrix).

## D-010: Sign-in errors stay non-revealing; clearer wording instead of separate messages
- Date: 2026-11-05
- Status: accepted (owner chose option A)
- Type: 1 (auth)
- Context: the owner asked for separate "email not registered" / "wrong password" messages, possibly using a Bloom filter to check registration.
- Options: (A) one message for both, made clearer (chosen); (B) separate messages; (C) separate messages with a Bloom filter in front.
- Decision:
  - Unknown email and wrong password return the same 401 and the same text: "That email and password don't match. Check both, or reset your password." The form shows a "Reset your password" link with it. Timing stays equal (dummy bcrypt compare).
  - The form checks format itself before sending: empty email, malformed email, empty password, each shown under its field.
  - A lockout (429) says how long to wait.
  - "Deactivated" is shown only after the right password, so it reveals nothing to a stranger.
  - Forgot-password stays non-revealing as before.
- Why not a Bloom filter: it answers only "definitely not" or "maybe", so the database lookup is still needed; the email lookup is already one indexed query; it would need rebuilding on every server instance and syncing on invite/deactivate; and it doesn't change what the message reveals.
- Revisit when: the app gets public self-sign-up (then the sign-up form reveals registration anyway and the trade-off changes).

## D-011: Members can be deleted as a soft delete; their time entries stay
- Date: 2026-11-06
- Status: accepted (owner chose soft delete, Administrator only)
- Type: 1 (data model, permissions). Amends D-006's "users are deactivated, never deleted".
- Context: the owner wants departed members gone from the Team page, with their logged time kept.
- Options: (A) soft delete, chosen; (B) soft delete + erase name and email; (C) hard delete with a name copied onto every entry and a nullable user link.
- Decision:
  - `bc_users` gets `deletedAt` and `deletedEmail` (migration `20261106000000_member_soft_delete`, additive).
  - Delete (Administrator only, never the Administrator account or yourself), in one transaction: deactivate, bump tokenVersion, revoke sessions and reset codes, stop a running timer, remove project memberships, move the email to `deletedEmail` and put a placeholder in `email` (frees the address), audit `user.delete`.
  - Deleted members are hidden from Team, pickers, filters and counts. Their entries keep `userId` (D-006's Restrict FK stands; the row is never removed) and show as "Name (deleted)" in lists, reports, CSV and PDF.
  - Restore (Administrator) puts the email back if still free (409 otherwise) and returns the member deactivated. Audited `user.restore`.
- Revisit when: a privacy erasure request arrives (then add option B as a separate "erase personal data" action).

## D-012: One workspace time zone for everyone (default PKT)
- Date: 2026-11-10
- Status: accepted (owner asked for PKT and an Administrator setting; chose "everywhere" over "totals and reports only")
- Type: 1 (data model, every date in the app).
- Context: times were shown and days grouped in each viewer's computer zone, so the same entry could fall on different days for different people.
- Decision:
  - `bc_workspace_settings.timeZone` (IANA name, default `Asia/Karachi`; migration `20261110000000_workspace_time_zone`, additive). The Administrator changes it on Settings → Workspace; audited `workspace.time_zone`.
  - Entries are still stored as exact UTC instants; nothing is rewritten when the zone changes.
  - Server: every report, timesheet, dashboard and export groups days in the workspace zone; the `tz` the browser sends is ignored. Lock-date messages print the day in that zone.
  - Browser: `lib/time.ts` converts at the edges (`toZoned` for instants from the server, `toISO`/`fromZoned` before sending, `zonedNow` for "now"), so all calendar maths runs in the workspace zone whatever the computer is set to. The zone is set by `UserProvider` before any page renders; an open app reloads itself when the zone changes (via `/api/changes`).
- Revisit when: a team spans zones and wants per-person display (would need a per-user override on top of this).

## Implementation notes — 2026-11-05 fix run
Choices made while implementing the decisions above, for the owner to veto. None changes a decision's substance.
- **Order (D-006/D-007/D-008):** the Prisma 7 upgrade and migration baseline were done right after the test harness instead of last. D-001, D-003, D-005 and D-006 all change the schema, and D-006's CHECK and partial unique index can't be expressed with `db push`, so migrations had to exist first. D-007's condition (tests before the upgrade) was met: 42 tests covering raw SQL, timezone buckets and advisory locks passed on Prisma 6 first, then on 7.
- **Test database (D-007):** Postgres 18 inside WSL Ubuntu on the development machine (the "local container" option). A separate Supabase project was not used.
- **Test schema:** Prisma 7 refuses `migrate reset` when run by an AI agent without the owner's consent, so tests apply migrations with `migrate deploy` and empty tables per file. `scripts/recreate-test-db.sh` recreates the local test database if a migration is ever edited.
- **D-001:** member deletion was removed entirely (D-006 "never deleted"); decided member requests are deleted when their role is deleted (the audit log keeps the history).
- **D-002:** the timesheet calendar's entry list shows a notice above 500 entries rather than paging the calendar.
- **D-003:** access tokens now carry the session id (R-060) so single-device sign-out is immediate; cached for 60 s per session with tag invalidation.
- **D-005:** a running timer moved back more than 24 h is closed and flagged (not refused); stopping a timer on a now-archived project is refused with a hint to change the project (R-061), so the member isn't stuck.
- **R-046:** Server Components can't clear cookies, so the layout redirects through `/api/auth/signed-out`, which clears them only when the session really is invalid.
