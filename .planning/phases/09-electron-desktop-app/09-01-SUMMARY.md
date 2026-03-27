---
phase: 09-electron-desktop-app
plan: 01
subsystem: backend
tags: [hono, electron, sqlite, drizzle, better-sqlite3, factory-pattern, lazy-init]

# Dependency graph
requires:
  - phase: 07-exchange-api-security
    provides: JWT middleware, route registration pattern, index.ts server entry point
  - phase: 08-ui-redesign-sidebar-layout
    provides: Final app structure before Electron packaging

provides:
  - createApp() factory in app.ts that builds Hono instance without calling serve()
  - Thin index.ts: createApp() + serve() + triggerEngineBackground() only
  - initDb({ dbPath, migrationsPath }) for explicit DB path injection before first access
  - getMigrationsPath() utility for Electron to locate source migrations
  - Lazy Proxy-based db and sqlite exports with identical API surface

affects:
  - 09-02 (Electron main process imports createApp and calls initDb)
  - 09-03 (Electron packaging uses dist/app.js entry not index.js)
  - All future backend consumers that import db/client.ts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Factory function pattern for Hono app (createApp() instead of module-level instance)
    - Lazy singleton via Proxy for database module (deferred init, same export surface)
    - Explicit initDb() for dependency injection of DB path (Electron userData pattern)

key-files:
  created:
    - packages/backend/src/app.ts
  modified:
    - packages/backend/src/index.ts
    - packages/backend/src/db/client.ts

key-decisions:
  - "09-01-a: createApp() in app.ts imports all routes — index.ts is a pure entry point (serve only)"
  - "09-01-b: cors({ origin: '*' }) in createApp() — supports both web origins and Electron file:// origins"
  - "09-01-c: Proxy pattern for db/sqlite exports — lazy init without changing consumer import syntax"
  - "09-01-d: initDb() throws if called twice (already initialized guard) — prevents accidental double-init"
  - "09-01-e: Auto-init in ensureInitialized() reads DB_PATH env var — full backward compatibility for tests/dev"

patterns-established:
  - "Backend app is now side-effect-free on import: no serve(), no DB file creation until first db access"
  - "Electron main process pattern: call initDb({ dbPath }) before importing any routes, then import createApp"

# Metrics
duration: 6min
completed: 2026-03-27
---

# Phase 9 Plan 01: Backend Refactor — createApp() Factory and Lazy DB Init Summary

**Hono createApp() factory extracted from index.ts, plus Proxy-based lazy DB initialization enabling Electron integration without module-level side effects**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-27T10:23:44Z
- **Completed:** 2026-03-27T10:29:35Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `packages/backend/src/app.ts` now exports `createApp()` — builds the fully-configured Hono app (middleware + all routes) without triggering `serve()`, making it safe to import from Electron main process
- `packages/backend/src/index.ts` reduced from 49 to 10 lines: `createApp()` + `serve()` + `triggerEngineBackground()` only
- `packages/backend/src/db/client.ts` refactored to lazy Proxy singleton — `db` and `sqlite` remain named exports with identical API surface, but DB only opens on first access; `initDb()` and `getMigrationsPath()` now exported for Electron

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract createApp() into packages/backend/src/app.ts** - `b2ff8bb` (feat)
2. **Task 2: Make db/client.ts support deferred initialization with configurable paths** - `cc03865` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/backend/src/app.ts` - New: createApp() factory exporting fully-configured Hono app
- `packages/backend/src/index.ts` - Modified: reduced to thin server entry point using createApp()
- `packages/backend/src/db/client.ts` - Modified: lazy Proxy singleton with initDb() and getMigrationsPath() exports

## Decisions Made
- `cors({ origin: '*' })` used instead of default `cors()` to explicitly allow Electron `file://` origins alongside web origins
- Proxy pattern chosen for `db`/`sqlite` exports to preserve exact import syntax for all 62 existing test files that `vi.mock('../db/client.js')`
- `initDb()` throws `Error('Database already initialized')` if called twice — fail-fast guard prevents accidental double-initialization
- `ensureInitialized()` internal function reads `process.env.DB_PATH ?? 'cryptax.db'` for full backward compatibility with dev server and test environment

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

`npm run build -w packages/backend` fails with pre-existing TypeScript errors in test files (test files include strict null checks, `TS2558` type argument errors, etc. from prior phases). These errors existed before this plan — confirmed by `git stash` and re-running the build on the unmodified codebase. The build failure is not introduced by this plan. All 947 tests pass correctly via vitest (which uses its own transpiler, not tsc).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `createApp()` is ready for Electron main process to import — no side effects on import
- `initDb({ dbPath: app.getPath('userData') + '/cryptax.db', migrationsPath: ... })` pattern is fully implemented
- `getMigrationsPath()` available for Electron to locate bundled migrations
- Phase 09-02 (Electron main process scaffold) can now safely import `createApp` and `initDb`

---
*Phase: 09-electron-desktop-app*
*Completed: 2026-03-27*
