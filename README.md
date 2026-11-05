# Bitsclock

Time tracking for teams, in one Next.js project (frontend + API): timers and manual entries, projects, reports with CSV/PDF export, and roles with custom permissions.

## Stack

- Next.js 16 (App Router, route handlers as the backend), React 19, TypeScript, Tailwind CSS 4
- Prisma 6 + PostgreSQL on Supabase
- Sessions: short-lived access JWT (`bc_access`, 15 min) plus a rotating opaque refresh token (`bc_refresh`, hashed at rest), both httpOnly cookies; passwords hashed with bcrypt
- Charts: Recharts · PDF export: jsPDF + autotable

## Setup

1. **Database.** In Supabase: *Connect → ORMs → Prisma*. Copy the two strings into `.env`:
   - `DATABASE_URL` – transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1`
   - `DIRECT_URL` – session pooler / direct connection (port 5432)
2. **Secret.** `.env` already contains a generated `AUTH_SECRET`. Use a different one in production.
3. **Install and create the schema:**

   ```bash
   npm install
   npm run db:push      # creates the tables (uses DIRECT_URL)
   npm run db:seed      # system roles, an admin, sample members, projects and entries
   npm run dev
   ```

4. Open http://localhost:3000 and sign in:

   | Account | Email | Password |
   |---|---|---|
   | Administrator | admin@bitsclock.com | Admin@12345 |
   | Manager (custom role) | sara@bitsclock.com | Employee@123 |
   | Employee | ali@bitsclock.com, hina@bitsclock.com | Employee@123 |

   Change these from **Team → Reset password** before sharing the app.

## What's inside

| Area | Where |
|---|---|
| Data model (roles, permissions, users, projects, time entries) | `prisma/schema.prisma` |
| Permission catalog | `src/lib/permissions.ts` |
| Auth + session helpers | `src/lib/auth.ts`, `src/proxy.ts` (route protection) |
| Time entry rules (one running timer, no overlaps, archived projects) | `src/lib/entries.ts` |
| Report aggregation and CSV | `src/lib/reports.ts` |
| API routes | `src/app/api/**` |
| Pages | `src/app/(app)/**` → views in `src/components/**` |

### Roles and permissions

- **Administrator** (system): every permission, cannot be edited or deleted. The last active administrator cannot be deactivated or demoted.
- **Employee** (system): editable permissions, cannot be deleted. Default: track own time, view projects, own reports, export.
- **Custom roles**: created on *Roles & permissions* by anyone with `roles.manage`, then assigned on *Team*.

Permissions: `time.track`, `time.view_all`, `time.manage_all`, `projects.view`, `projects.manage`, `reports.view_own`, `reports.view_all`, `reports.export`, `dashboard.team`, `users.view`, `users.manage`, `roles.manage`.

### Time tracking rules

- One running timer per member. Starting a second one is refused.
- Manual entries need end after start, at most 24 hours, not in the future, and may not overlap another entry (the running timer counts).
- Archived projects keep their history but accept no new time.
- Deactivating a member stops their running timer and keeps their entries in reports.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:push` | Apply the Prisma schema to the database |
| `npm run db:seed` | Seed roles, admin and sample data (safe to re-run) |
| `npm run db:studio` | Browse the database |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## Deploying to Vercel

Set `DATABASE_URL`, `DIRECT_URL` and `AUTH_SECRET` in the project environment. `postinstall` runs `prisma generate`; run `npm run db:push` once against the production database from your machine.

For more than one instance (Vercel always), also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so the response cache and the rate limiter are shared by every instance (see below).

## Reliability

- **Safe retries.** The client sends an `Idempotency-Key` with every mutation and retries network failures, timeouts and 502/503/504 with a short backoff. The server stores the first response under the key for 24 hours and replays it for any retry (`Idempotent-Replayed: true`), so a dropped connection or a double click can never create a duplicate entry.
- **Per-member locking.** Every time-entry write runs in a transaction holding a PostgreSQL advisory lock on the member, so the "one running timer" and "no overlapping entries" rules hold even under concurrent requests from several tabs or a retry racing the original.
- **Fallbacks.** Pages keep rendering the last good data while a request fails, show an offline banner, and refetch everything automatically when the connection returns. Prisma retries transient database errors with backoff.

## Bulk endpoints

- `GET /api/bootstrap`: the signed-in user, their projects, the member list and their running timer in one round trip. The shell seeds its cache from it on load.
- `POST /api/time-entries/bulk`: up to 200 manual entries at once (`{ entries: [...], atomic?: true, userId?: "me" }`). Atomic by default (any bad row rejects the batch and names its index); with `atomic: false` the valid rows are saved and the rest are returned under `errors`.
- `DELETE /api/time-entries/bulk`: `{ ids: [...] }`, up to 500, own entries only unless the caller may edit everyone's time.

## Activities

Besides projects, administrators can create **activities**: non-project buckets such as lunch breaks, internal meetings or training that members log time against. They share the project rules (colour, billable default, who may log time) but are shown under their own heading in pickers and have their own filter on the Projects page.

## Performance and scale

How the app stays fast as the team and the history grow:

- **Aggregates run in PostgreSQL.** Reports, the dashboard, the timesheet, project totals and member totals are `GROUP BY` queries over the time-entry indexes (`userId+startTime`, `projectId+startTime`, `startTime`, `userId+projectId`). Nothing pulls raw rows into Node to sum them; day bucketing in the viewer's time zone happens in SQL too.
- **Two-level response cache.** Every read endpoint is cached in process memory and, when Redis is configured, in a shared Upstash store. Entries are tagged (`users`, `roles`, `projects`, `entries`); a mutation bumps the tag, so every instance drops stale data at once. Identical concurrent requests are coalesced into one database query per instance.
- **Browser cache.** Responses carry `ETag` and `Cache-Control: private, max-age, stale-while-revalidate`, and the client keeps a small in-memory cache per URL, so navigating between pages rarely waits on the network.
- **Connection pooling.** The runtime URL goes through Supabase's transaction pooler (`pgbouncer=true`). Use `connection_limit=3..5` per serverless instance, `8..10` for one long-running server. Prisma retries transient pool errors with backoff.
- **Rate limiting.** Per-IP on every route (600 reads / 120 writes per minute), stricter on sign-in (20 per IP and 8 per account per 15 minutes). Shared across instances through Redis when configured.
- **Lean client bundles.** Charts (Recharts) and PDF export (jsPDF) are loaded on demand, after the page and its data are on screen.
- **Schema.** Tables are in third normal form: roles and their permissions, users, projects, project membership and time entries each live in their own table and are joined by keys. The one derived column, `durationSeconds` on time entries, is always written by the server from the start and end instants and exists so totals are a single `SUM` on an indexed scan.

Capacity: a single Vercel region with the pooled Supabase connection comfortably serves about a thousand concurrent users at the request rates a time tracker produces (a few requests per user per minute), because almost every read is a cache hit and every write is one indexed insert or update. Scale further by raising the Supabase compute tier (more pooled connections) and keeping Redis in the same region as the functions.
