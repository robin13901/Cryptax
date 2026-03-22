---
phase: 01-foundation-ci-cd
plan: 03
subsystem: database
tags: [sqlite, drizzle-orm, drizzle-kit, better-sqlite3, wal, strict-tables, migrations]

# Dependency graph
requires:
  - phase: 01-02
    provides: Hono backend package where db client will be imported
  - phase: 01-04
    provides: MoneyString = string alias used in domain interfaces matching TEXT column convention
provides:
  - Drizzle ORM schema with all 8 Phase 1 tables
  - SQLite client singleton with WAL mode and foreign key enforcement
  - Initial migration SQL with STRICT keyword on all tables
  - drizzle.config.ts at repo root for generate/migrate workflow
affects:
  - 01-06: CI/CD pipeline (db:generate and db:migrate commands already in root package.json)
  - Phase 2 (CSV import): transactions table ready for import
  - Phase 3 (price cache): price_cache table with TEXT EUR columns
  - Phase 4 (FIFO engine): fifo_lots and lot_consumptions tables
  - Phase 5 (tax summaries): tax_summaries table with bucketed aggregation
  - Phase 6 (reporting): all tables queryable via Drizzle ORM
  - Phase 7 (exchange API): exchange_connections table

# Tech tracking
tech-stack:
  added:
    - drizzle-orm (SQLite ORM with TypeScript schema)
    - drizzle-kit (migration generator and applier)
    - better-sqlite3 (synchronous SQLite driver)
    - "@types/better-sqlite3"
  patterns:
    - All monetary columns declared as text() in Drizzle schema (never real() or integer())
    - STRICT mode on every CREATE TABLE (enforces type checking at SQLite level)
    - WAL mode pragma applied at client startup for concurrent read performance
    - foreign_keys = ON pragma applied at client startup (SQLite default is OFF)
    - DB_PATH configurable via DB_PATH env var with fallback to 'cryptax.db'
    - Migration workflow: drizzle-kit generate then manual STRICT addition then drizzle-kit migrate

key-files:
  created:
    - packages/backend/src/db/schema.ts
    - packages/backend/src/db/client.ts
    - packages/backend/src/db/index.ts
    - drizzle.config.ts
    - packages/backend/drizzle/0000_initial.sql
    - packages/backend/drizzle/meta/_journal.json
    - packages/backend/drizzle/meta/0000_snapshot.json
  modified:
    - packages/backend/package.json (added drizzle-orm, better-sqlite3, drizzle-kit deps)

key-decisions:
  - "drizzle-kit generate does NOT add STRICT — manual edit of migration SQL required after each generate run"
  - "Migration file renamed from 0000_strange_runaways.sql to 0000_initial.sql for clarity; journal tag updated to match"
  - "WAL pragma runs in client.ts at startup — migration-created DB starts in delete mode until first client connection"
  - "DB_PATH env var allows test isolation (point to test DB without touching cryptax.db)"
  - "sqlite export from client.ts typed as Database.Database interface for proper declaration file generation"

patterns-established:
  - "TEXT monetary columns: all amount/price/fee/pnl/gains/losses fields use text() — never real()/integer()"
  - "STRICT tables: all CREATE TABLE statements in migration SQL must end with ) STRICT;"
  - "Client singleton pattern: import { db } from '@/db' for all queries"
  - "Migration workflow: npm run db:generate → add STRICT manually → npm run db:migrate"

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 1 Plan 03: SQLite + Drizzle ORM Foundation Summary

**Drizzle ORM schema with 8 STRICT SQLite tables, TEXT-only monetary columns, WAL+FK client singleton, and automated migration workflow via drizzle-kit**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T16:29:00Z
- **Completed:** 2026-03-21T16:35:57Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- All 8 Phase 1 tables defined in schema.ts with Drizzle ORM (transactions, price_cache, fifo_lots, lot_consumptions, futures_positions, earn_income, tax_summaries, exchange_connections)
- Every monetary column (amount, price, fee, total_value, cost_basis, proceeds, gain_loss, pnl, EUR values) typed as TEXT — enforces Decimal.js usage and prevents floating-point drift
- Migration SQL generated, STRICT added to all 8 CREATE TABLE statements, applied successfully to cryptax.db
- Client singleton applies WAL and foreign_keys pragmas on connection, indexes and unique constraints in place

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Drizzle dependencies and create schema** - `cfd2295` (feat)
2. **Task 2: Generate migration, add STRICT, and verify** - `c932bf6` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/backend/src/db/schema.ts` - All 8 Drizzle table definitions with TEXT monetary columns
- `packages/backend/src/db/client.ts` - Database singleton with WAL + FK pragmas via better-sqlite3
- `packages/backend/src/db/index.ts` - Barrel re-export for schema and client
- `drizzle.config.ts` - Drizzle Kit config at repo root (dialect: sqlite, points to packages/backend paths)
- `packages/backend/drizzle/0000_initial.sql` - Initial migration with STRICT on all 8 CREATE TABLE statements
- `packages/backend/drizzle/meta/_journal.json` - Migration journal (tag: 0000_initial)
- `packages/backend/drizzle/meta/0000_snapshot.json` - Schema snapshot for drift detection
- `packages/backend/package.json` - Added drizzle-orm, better-sqlite3, drizzle-kit, @types/better-sqlite3

## Decisions Made

- **STRICT is not automatic**: drizzle-kit generate never outputs STRICT; it must be manually added after each generate run. This is a mandatory step in the migration workflow.
- **Migration file renaming**: The auto-generated filename `0000_strange_runaways.sql` was renamed to `0000_initial.sql` and the journal tag updated accordingly for clarity and predictability.
- **WAL mode timing**: The WAL pragma runs in client.ts at application startup. The migration-created database starts in `delete` mode — WAL mode is activated on first client connection. This is correct behavior.
- **DB_PATH env var**: The client reads `process.env.DB_PATH` with fallback to `'cryptax.db'`, enabling test isolation by pointing to an in-memory or temporary DB.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript declaration export type error**

- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** Exporting `sqlite` variable with type `BetterSqlite3.Database` from a namespace caused TS4023 error with `declaration: true` enabled
- **Fix:** Added explicit `import type { Database as SqliteDatabase } from 'better-sqlite3'` and annotated the export with that interface type
- **Files modified:** `packages/backend/src/db/client.ts`
- **Verification:** `npx tsc -b` passes with zero errors
- **Committed in:** `cfd2295` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added DB_PATH env var for test isolation**

- **Found during:** Task 1 (client.ts implementation)
- **Issue:** Hardcoding `'cryptax.db'` path prevents test isolation — tests would mutate the development database
- **Fix:** Read `process.env.DB_PATH` with fallback to `'cryptax.db'`
- **Files modified:** `packages/backend/src/db/client.ts`
- **Verification:** Path is configurable; future test suites can set `DB_PATH=:memory:` or temp file
- **Committed in:** `cfd2295` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes essential for compilation correctness and test isolation. No scope creep.

## Issues Encountered

- Biome `useLiteralKeys` lint rule flagged `process.env['DB_PATH']` — fixed to `process.env.DB_PATH` via `--unsafe` flag (this lint rule treats computed property access on well-known objects as simplifiable)
- Biome import ordering required `import type` before `import` for same module — auto-fixed with `--write`

## User Setup Required

None - no external service configuration required. `cryptax.db` is gitignored and created by `npm run db:migrate`.

## Next Phase Readiness

- Database schema ready for all Phase 2 CSV import features (transactions table)
- Migration workflow established: `npm run db:generate` + add STRICT + `npm run db:migrate`
- All downstream phases (2–7) have their tables ready
- **Important**: After any future `npm run db:generate`, the developer must manually add `STRICT` to new CREATE TABLE statements in the generated SQL before migrating

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
