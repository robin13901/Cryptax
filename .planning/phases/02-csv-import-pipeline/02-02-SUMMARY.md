---
phase: 02-csv-import-pipeline
plan: "02"
subsystem: import
tags: [csv-parse, typescript, tdd, bitget, spot-transactions, parser]

# Dependency graph
requires:
  - phase: 02-01
    provides: import_batches table, csv-parse library, shared ImportError type
provides:
  - parseSpotTx function that converts pre-parsed CSV rows to typed ParsedSpotTx objects
  - ParsedSpotTx interface (orderId, tradedAt, symbol, rawType, amount, fee, available, sourceFile)
  - SpotTxParseResult type ({ transactions, errors })
  - Case-insensitive column key normalisation helper
  - CANONICAL_DISPLAY map for consistent error field names across missing/present fields
affects:
  - 02-07 (canonical type mapper will consume rawType from ParsedSpotTx)
  - 02-08 (batch insert pipeline will consume parseSpotTx output)
  - Any future plan referencing spot_tx source type

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD red-green-refactor with Vitest 3
    - Case-insensitive key normalisation for CSV column handling
    - Error-per-row with first-failing-field early exit (no exceptions, collect all row errors)
    - CANONICAL_DISPLAY fallback for absent fields in error messages

key-files:
  created:
    - packages/backend/src/import/parsers/spot-tx.ts
    - packages/backend/src/import/parsers/spot-tx.test.ts
  modified: []

key-decisions:
  - "CANONICAL_DISPLAY map used for error field names when key absent: returns 'Date'/'Coin'/'Type'/'Amount' not lowercase fallback"
  - "Case-insensitive normalisation applied first — all downstream field access uses dot notation on normalised row"
  - "Tab-stripping on orderId is defensive guard: csv-parse trim handles it, but parser strips anyway for safety"
  - "First-missing-field-per-row break: reports one error per invalid row, skips row cleanly"

patterns-established:
  - "Parser pattern: normaliseKeys() → validate required fields → map to typed output — reusable across all 5 parsers"
  - "Error shape: { row: number, field: string, message: string, rawData?: string } from shared ImportError type"

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 02 Plan 02: Spot Transactions Parser Summary

**parseSpotTx function parsing both 2024 (semicolon) and 2025 (comma) Bitget spot CSV formats into typed ParsedSpotTx objects with case-insensitive column handling and row-level error collection**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T20:45:02Z
- **Completed:** 2026-03-21T20:49:35Z
- **Tasks:** 2 (RED + GREEN TDD phases; no refactor needed)
- **Files modified:** 2

## Accomplishments
- `ParsedSpotTx` interface defined with all 8 fields matching the Bitget spot CSV columns
- `parseSpotTx` function handles both 2024 semicolon-delimited and 2025 comma-delimited formats identically after csv-parse normalisation
- Case-insensitive key normalisation allows `order`/`Order` and all other column variants to work seamlessly
- Row-level error collection: invalid rows produce `ImportError` objects, valid rows continue to `transactions` array

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `d567f43` (test)
2. **Task 2 (GREEN): Implementation** - `115a7bc` (feat)

_Note: TDD tasks — RED committed first, GREEN committed after all 23 tests pass. No REFACTOR commit needed (code was clean after GREEN)._

## Files Created/Modified
- `packages/backend/src/import/parsers/spot-tx.ts` - ParsedSpotTx interface, SpotTxParseResult type, parseSpotTx function (145 lines)
- `packages/backend/src/import/parsers/spot-tx.test.ts` - 23 tests across 6 describe blocks covering happy path, tab-stripping, case-insensitive keys, validation errors, real fixture rows, edge cases (356 lines)

## Decisions Made

1. **CANONICAL_DISPLAY map for error field names:** When a required field key is completely absent from the row (not just empty), `originalCasing()` was returning the lowercase fallback (`'date'`). A `CANONICAL_DISPLAY` map was added to return the correct Bitget casing (`'Date'`/`'Coin'`/`'Type'`/`'Amount'`) in error messages. The `'order'` field keeps lowercase since that is its actual Bitget CSV casing.

2. **First-missing-field early exit per row:** The validator breaks on the first missing field per row and adds one error. This avoids flooding the error array with multiple errors for the same empty row.

3. **Tab-stripping as defensive guard:** csv-parse with `trim: true` already strips the leading `\t` from order IDs. The parser applies `replace(/^\t+/, '').trim()` defensively — tests confirm no leading tab reaches the output orderId.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CANONICAL_DISPLAY map for absent-key error reporting**
- **Found during:** GREEN phase (first test run)
- **Issue:** `originalCasing()` returned lowercase `'date'` when `Date` key was absent from row; test expected `'Date'` per Bitget CSV header casing
- **Fix:** Added `CANONICAL_DISPLAY` constant mapping each required lowercase field to its canonical Bitget display name; `originalCasing` now falls back to this map instead of the raw lowercase string
- **Files modified:** `packages/backend/src/import/parsers/spot-tx.ts`
- **Verification:** `produces error for row with missing Date` test passes
- **Committed in:** `115a7bc` (feat commit)

---

**Total deviations:** 1 auto-fixed (1 bug in error field-name reporting)
**Impact on plan:** Minimal — single missing-key edge case in error reporting. No scope creep. All other tests passed on first GREEN run.

## Issues Encountered
- Biome `useLiteralKeys` lint rule flagged bracket notation (`row['order']`) on the normalised `Record<string, string>` — replaced with dot notation (`row.order`) after biome format pass. Standard workflow per project decision 01-02.
- Biome `organizeImports` reordered test file imports (`import type` before value import from same module). Applied with `biome check --write`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `parseSpotTx` is production-ready and fully tested (23 tests, 128 total passing)
- `ParsedSpotTx` interface is exported and available for 02-07 (canonical type mapper) and 02-08 (batch insert pipeline)
- Established parser pattern (normaliseKeys → validate → map) is ready for reuse in remaining parsers (futures-tx, earn, spot-order, futures-order)

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
