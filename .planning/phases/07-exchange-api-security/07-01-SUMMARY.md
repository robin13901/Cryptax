---
phase: 07-exchange-api-security
plan: 01
subsystem: auth
tags: [jwt, scrypt, hono, sqlite, cookie, session, password-hashing]

# Dependency graph
requires:
  - phase: 01-foundation-ci-cd
    provides: Hono server setup, Drizzle ORM, SQLite migrations infrastructure
  - phase: 04-fifo-engine-tax-calculation
    provides: DB schema patterns and in-memory SQLite test patterns
provides:
  - app_settings table (key/value store for server-side config)
  - hashPassword/verifyPassword with scrypt + timingSafeEqual (node:crypto)
  - hasPassword/getPasswordHash/setPasswordHash via app_settings
  - JWT session middleware protecting all /api/* routes except /api/auth/*
  - Auth endpoints: setup, login, logout, status
  - credential_master_key seed for 07-02 credential encryption
affects:
  - 07-02 (credential encryption needs credential_master_key and auth-store)
  - 07-03 (exchange sync needs authenticated API access)
  - All future API routes (all require valid session cookie)

# Tech tracking
tech-stack:
  added: [hono/jwt (HS256), hono/cookie (setCookie/deleteCookie)]
  patterns:
    - JWT session via httpOnly sameSite:Strict cookie (no maxAge = session-only)
    - scrypt with randomBytes(16) salt + timingSafeEqual for constant-time comparison
    - app_settings key/value table for server-side persistent configuration
    - JWT_SECRET generated ephemerally via randomBytes(32) if env not set

key-files:
  created:
    - packages/backend/src/auth/crypto.ts
    - packages/backend/src/auth/auth-store.ts
    - packages/backend/src/routes/auth.ts
    - packages/backend/drizzle/0003_app_settings.sql
  modified:
    - packages/backend/src/db/schema.ts
    - packages/backend/src/index.ts

key-decisions:
  - "07-01-a: JWT algorithm is HS256 — Hono jwt middleware requires explicit alg parameter"
  - "07-01-b: JWT_SECRET is process.env.JWT_SECRET ?? randomBytes(32).toString('hex') — ephemeral if not set, persists for server lifetime"
  - "07-01-c: Session cookie has no maxAge (session-only per CONTEXT.md decision)"
  - "07-01-d: credential_master_key generated and stored at setup time for 07-02 use"
  - "07-01-e: Existing route tests unaffected — all create isolated Hono instances, do not import index.ts"

patterns-established:
  - "Auth-exempt routes: middleware checks path.startsWith('/api/auth/') before applying JWT"
  - "Test auth helper: buildTestApp() mirrors index.ts wiring; setupAndLogin() returns cookie string"
  - "Migration pattern: 0003_app_settings.sql manually written with STRICT (same as prior migrations)"

# Metrics
duration: 12min
completed: 2026-03-23
---

# Phase 7 Plan 1: Auth Foundation Summary

**Password-protected backend with scrypt hashing, JWT session cookies, and Hono middleware gating all API routes**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-23T18:28:00Z
- **Completed:** 2026-03-23T18:40:06Z
- **Tasks:** 2
- **Files modified:** 8 (2 modified, 6 created)

## Accomplishments

- app_settings SQLite table with STRICT keyword migration (key/value/updatedAt)
- scrypt-based password hashing with random 16-byte salt and timingSafeEqual constant-time comparison
- auth-store module for reading/writing password hash via app_settings upsert
- Four auth endpoints: GET /api/auth/status, POST /api/auth/setup (201), POST /api/auth/login (sets httpOnly cookie), POST /api/auth/logout
- JWT middleware (HS256) in index.ts blocking all /api/* except /api/auth/* — returns 401 without valid session
- 765 total tests passing (23 new auth tests, zero regressions from prior 742)

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration + crypto + auth-store** - `211fc7c` (feat)
2. **Task 2: Auth routes + JWT middleware** - `f4a7be1` (feat)

## Files Created/Modified

- `packages/backend/drizzle/0003_app_settings.sql` — CREATE TABLE app_settings STRICT migration
- `packages/backend/src/db/schema.ts` — appSettings table definition added
- `packages/backend/src/auth/crypto.ts` — hashPassword (scrypt+salt) + verifyPassword (timingSafeEqual)
- `packages/backend/src/auth/crypto.test.ts` — 7 tests: format, determinism, correct/wrong password, edge cases
- `packages/backend/src/auth/auth-store.ts` — hasPassword, getPasswordHash, setPasswordHash (upsert)
- `packages/backend/src/auth/auth-store.test.ts` — 5 tests: initial state, set, get, overwrite
- `packages/backend/src/routes/auth.ts` — registerAuthRoutes + JWT_SECRET export
- `packages/backend/src/routes/auth.test.ts` — 11 tests: all 4 endpoints + JWT middleware gate
- `packages/backend/src/index.ts` — JWT middleware added before all route registrations

## Decisions Made

- **07-01-a: HS256 algorithm required** — Hono's jwt() middleware throws if `alg` is not provided; using HS256 with string secret
- **07-01-b: Ephemeral JWT_SECRET** — `process.env.JWT_SECRET ?? randomBytes(32).toString('hex')` — works for dev/test, production should set the env var
- **07-01-c: Session-only cookie** — No `maxAge`, no `expires` on the session cookie per CONTEXT.md decision
- **07-01-d: credential_master_key seeded at setup** — POST /api/auth/setup also writes `credential_master_key` (32 random bytes hex) to app_settings for 07-02 credential encryption use
- **07-01-e: Existing tests unaffected** — All existing route tests instantiate isolated Hono apps and mock the DB; they never import index.ts, so the JWT middleware doesn't touch them

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Hono JWT middleware requires explicit `alg: 'HS256'` parameter — plan did not mention this, discovered during implementation. Handled immediately (Rule 3 - Blocking).

## Next Phase Readiness

- Auth backend complete. All /api/* routes require a valid session cookie.
- credential_master_key is stored in app_settings at setup time — 07-02 can read it for AES-GCM credential encryption.
- JWT_SECRET should be moved to environment variable in production config.

---
*Phase: 07-exchange-api-security*
*Completed: 2026-03-23*
