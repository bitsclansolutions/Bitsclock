# Status — 2026-11-05

## Where things stand
All 71 risks in `risks.md` are resolved in code except four that need the owner (below).
Waves 1–4 were implemented in one run on 2026-11-05 on top of the git baseline commit
`6782e33`; the changes are not committed yet.

Checks at the end of the run:
| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` (Vitest, real Postgres 18) | 146 passed |
| `npm run test:e2e` (Playwright, Chrome) | 8 passed |
| `npm audit` | 0 vulnerabilities |
| `next build` (clean copy on C:, `npm ci`) | succeeds, 47 routes |
| Production start with incomplete config | refuses, naming APP_URL and Redis |

## Done 2026-11-05 (with Claude)
- Node 24.22.2 installed on this machine (official MSI from nodejs.org, SHA-256 verified). Don't use a plain `winget upgrade OpenJS.NodeJS.LTS`: it goes to Node 26, outside `engines`.
- Supabase: baseline marked applied, the four new migrations applied cleanly.
- Pooler check: `/api/health` reports database and Redis up; repeated Prisma queries through the pooler work, with no prepared-statement errors. Still worth signing in and opening Tracker and Reports yourself.

## Done 2026-11-06 (with Claude)
- Migration `20261106000000_member_soft_delete` applied to Supabase (D-011, member soft delete).
- Tracker: "Last 90 days", "This year", "All time"; Scroll / Pages loading with rows per page; inline entry editing.
- Checks: typecheck and lint clean, 154 Vitest tests and 8 Playwright tests pass.

## Owner actions, in this order
1. **Node.js** (R-010): set Node 24.x on Vercel. Another Node security release is due 2026-11-11; install it the same way when it ships.
2. **Postgres version** (R-071): Supabase → Project Settings → Infrastructure, or `select version();`. Below 15: upgrade from that page before 2026-11-12, after a backup.
3. ~~Migrate the Supabase database~~ done 2026-11-05. Future migrations: `npm run db:migrate`.
4. **Sign in and open Tracker and Reports** (`npm run dev`) as a final look; the automated pooler check already passed.
5. **Seed settings:** set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` (no defaults any more). Existing admin is never changed by the seed.
6. **Admin password** (R-070): change it from Profile before go-live.
7. **Demo users** (R-005): delete or deactivate sara@, ali@, hina@bitsclock.com before real data arrives. Members can't be deleted from the app any more (D-006); deactivate them on Team, or remove them in the Supabase SQL editor if they have no entries.
8. **Production env (Vercel):** `APP_URL` (https), `UPSTASH_REDIS_REST_*`, SMTP variables. The server refuses to start without `APP_URL` or Redis.
9. **Commit:** review `git diff 6782e33` and commit when happy.

## Build note
`next build` can't run on the exFAT X: drive (known drive limitation, see project notes). Build from a copy on C: before deploying; Vercel builds on its own machines and is unaffected.
