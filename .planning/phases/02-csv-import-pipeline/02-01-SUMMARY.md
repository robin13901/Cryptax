---
phase: 02-csv-import-pipeline
plan: 01
subsystem: database
tags: [drizzle-orm, sqlite, csv-parse, typescript, schema-migration]

# Dependency graph
requires:
  - phase: 01-foundation-ci-cd
    provides: Drizzle ORM setup, SQLite client, schema.ts, migration workflow, shared types foundation
provides:
  - import_batches table with STRICT mode (migration 0001_import_batches.sql)
  - nullable batch_id FK column on transactions table with index
  - csv-parse@6.2.1 installed in backend workspace
  - ImportBatch, PerFileResult, ImportFileError, ImportResponse types in @cryptax/shared
affects:
  - 02-02-csv-parsing (needs ImportBatch, PerFileResult types + csv-parse)
  - 02-03-import-api (needs import_batches table + batch_id FK)
  - 02-04-deduplication (needs batch_id on transactions)
  - all subsequent 02-* plans

# Tech tracking
tech-stack:
  added:
    - csv-parse@6.2.1 (backend dependency)
  patterns:
    - Migration rename workflow: drizzle-kit generate → rename file → update journal tag → add STRICT → migrate
    - Nullable FK with onDelete set null: integer('col').references(() => table.id, { onDelete: 'set null' })
    - Forward reference: importBatches defined before transactions so FK can reference it

key-files:
  created:
    - packages/backend/drizzle/0001_import_batches.sql
    - packages/backend/drizzle/meta/0001_snapshot.json
    - packages/shared/src/types/import.ts
  modified:
    - packages/backend/src/db/schema.ts
    - packages/backend/drizzle/meta/_journal.json
    - packages/backend/package.json
    - packages/shared/src/types/index.ts
    - packages/shared/src/index.ts
    - package-lock.json

key-decisions:
  - "importBatches table defined BEFORE transactions in schema.ts — required for FK forward reference in Drizzle"
  - "Migration auto-name (0001_overconfident_banshee) renamed to 0001_import_batches for readability; journal tag updated"
  - "Biome organize-imports reorders barrel export blocks alphabetically by source module path (import.js before tax.js before transaction.js)"

patterns-established:
  - "Forward reference pattern: tables that are FK targets must be defined earlier in schema.ts"
  - "Migration rename: delete auto-named .sql, write renamed file, update journal tag — same as 0000_initial workflow"

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 2 Plan 01: CSV Parsing Infrastructure Summary

**SQLite import_batches table with STRICT mode, nullable batch_id FK on transactions, csv-parse@6.2.1 installed, and ImportBatch/PerFileResult/ImportFileError/ImportResponse types exported from @cryptax/shared**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T20:35:13Z
- **Completed:** 2026-03-21T20:40:11Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `import_batches` table created in SQLite with STRICT mode via migration 0001_import_batches.sql
- Nullable `batch_id` FK column added to `transactions` table with `idx_transactions_batch_id` index
- csv-parse@6.2.1 installed as backend dependency
- Four shared import types created and exported from `@cryptax/shared`: `ImportBatch`, `PerFileResult`, `ImportFileError`, `ImportResponse`

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema changes + migration** - `b38a72f` (feat)
2. **Task 2: Install csv-parse + shared import types** - `a6fae42` (feat)

## Files Created/Modified

- `packages/backend/src/db/schema.ts` - Added `importBatches` table definition + `batchId` FK on transactions + `idx_transactions_batch_id` index
- `packages/backend/drizzle/0001_import_batches.sql` - Migration: CREATE TABLE import_batches STRICT + ALTER TABLE transactions ADD batch_id
- `packages/backend/drizzle/meta/_journal.json` - Updated tag from `0001_overconfident_banshee` to `0001_import_batches`
- `packages/backend/drizzle/meta/0001_snapshot.json` - Generated snapshot for migration 0001
- `packages/backend/package.json` - Added csv-parse@^6.2.1 to dependencies
- `packages/shared/src/types/import.ts` - New file: ImportBatch, PerFileResult, ImportFileError, ImportResponse interfaces
- `packages/shared/src/types/index.ts` - Added re-exports for all four import types
- `packages/shared/src/index.ts` - Added re-exports for all four import types
- `package-lock.json` - Updated with csv-parse installation

## Decisions Made

- **importBatches defined before transactions in schema.ts**: Drizzle requires FK target tables to be declared before referencing tables. Moved importBatches to the top of schema.ts so `transactions.batchId` can reference `importBatches.id`.
- **Migration auto-name renamed**: drizzle-kit generated `0001_overconfident_banshee.sql` — renamed to `0001_import_batches.sql` for clarity, journal tag updated to match. Follows same convention as `0000_initial`.
- **Biome import ordering**: Biome's `organizeImports` sorts export blocks alphabetically by source path. `import.js` < `tax.js` < `transaction.js`, so import types appear first in barrel files.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `npm run build -w packages/shared` failed — shared package has no `build` script (uses TypeScript source directly via tsx). Verified compilation success via `npm run build -w packages/backend` which depends on shared. No fix needed.
- `sqlite3` CLI not available in environment — DB verification done via Node.js/better-sqlite3 instead. All checks passed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 02-02 (CSV parsers) can proceed: csv-parse installed, shared types available
- Plan 02-03 (Import API) can proceed: `import_batches` table exists with STRICT, `batch_id` FK on transactions
- All must-haves from 02-01 satisfied: table with STRICT, nullable batch_id FK, csv-parse, shared types

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
