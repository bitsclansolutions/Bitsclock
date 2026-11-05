# Testing

Decision: D-007. Tools: Vitest 5 (unit and API tests) and Playwright (browser smoke tests).

## The test database
Tests run against a **dedicated local Postgres database whose name ends in `_test`**. Every
test file empties every table, so `scripts/test-env.mjs` refuses to run unless `.env.test`
points at `localhost` / `127.0.0.1` and a database named `*_test`. The Supabase databases
can never be targeted.

Development machine setup (Windows, done 2026-11-05):
- Postgres 18 inside WSL Ubuntu (`apt install postgresql`), role and database `bitsclock_test`.
- `.env.test` (git-ignored) holds the local connection string and a test-only `AUTH_SECRET`.
  Copy `.env.test.example` to start one.
- `TEST_DB_WSL_DISTRO="Ubuntu"` makes the test runners start Postgres in WSL and keep the
  distro awake for the run (WSL otherwise stops an idle distro).

## Commands
| Command | What it runs |
|---|---|
| `npm test` | All Vitest files in `tests/unit` and `tests/api` |
| `npm run test:watch` | Same, re-running on save |
| `npm run test:e2e` | Playwright smoke tests in `tests/e2e`, against a dev server on port 3100 using `.next-e2e` (it doesn't disturb `npm run dev`) and the installed Chrome |
| `npm run test:db:reset` | Rebuild the test database from migrations (Prisma asks for your consent) |

The runners apply pending migrations with `prisma migrate deploy` before each run. If a
migration is edited after it was applied, recreate the local database:
`wsl -d Ubuntu -u root -- bash /mnt/x/projects/vscode/Bitsclock/scripts/recreate-test-db.sh`.

Browser smoke suite (`tests/e2e/smoke.spec.ts`): sign-in, timer start/stop, overlap 409,
report scoping 403, CSV rows = report total, refresh without an access token, keyboard-only
row menu (R-009), dialog keeps focus while a timer ticks (R-007).

## How API tests work
- Route handlers are imported and called directly with a real `Request` (`tests/helpers/http.ts`).
- `next/headers` cookies are replaced by an in-memory jar (`tests/helpers/cookies.ts`); one jar is one browser.
- `tests/helpers/factories.ts` creates unique users and roles; `signIn(user)` gives a browser with a real session.
- Files run one at a time (shared database). Rate limits are raised in `.env.test`; Redis and SMTP are off.
- Concurrency tests (R-069) run against the real Postgres with real parallel requests, never mocks.
