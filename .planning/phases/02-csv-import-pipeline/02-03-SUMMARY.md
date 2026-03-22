---
phase: 02-csv-import-pipeline
plan: 03
subsystem: api
tags: [csv-parse, typescript, tdd, vitest, biome, bitget, futures]

# Dependency graph
requires:
  - phase: 02-csv-import-pipeline/02-01
    provides: csv-parse installed, ImportFileError type from @cryptax/shared
provides:
  - parseFuturesTx function parsing Bitget futures_tx CSV rows into ParsedFuturesTx objects
  - ParsedFuturesTx interface with all 9-column futures format fields
  - ParseFuturesTxResult return type
  - 19 unit tests covering all 9 rawType strings and error cases
affects:
  - 02-07-normalization (rawType stored as-is, normalization to CanonicalType deferred here)
  - 02-08-import-orchestration (parseFuturesTx feeds into import pipeline)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "lowerRow() helper: build lowercase key map once per row for case-insensitive column access"
    - "Required-field validation with 1-indexed row numbers in ImportFileError records"
    - "rawType stored without mapping — normalization deferred to type-map plan"

key-files:
  created:
    - packages/backend/src/import/parsers/futures-tx.ts
    - packages/backend/src/import/parsers/futures-tx.test.ts
  modified: []

key-decisions:
  - "rawType preserved exactly as-is from CSV — no CanonicalType mapping in parser (deferred to 02-07)"
  - "Both Futures (trading pair) and Coin (settlement asset) columns captured as distinct fields on ParsedFuturesTx"
  - "Bitget typo 'risk_captital_user_transfer' must NOT be corrected — stored verbatim for downstream type mapping"
  - "lowerRow() used instead of column-name assumption — handles any column casing variation in future exports"

patterns-established:
  - "Parser accepts pre-parsed rows (Record<string,string>[]) not raw CSV text — csv-parse called by orchestrator"
  - "Tab-stripping applied via .trim() inside parser as safety measure (csv-parse trim:true is primary mechanism)"
  - "forEach replaced with for...of in tests — Biome lint/complexity/noForEach rule"

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 2 Plan 03: Futures Transactions Parser (TDD) Summary

**parseFuturesTx function mapping Bitget futures_tx CSV rows to ParsedFuturesTx with all 9 rawType strings preserved verbatim (including 'risk_captital_user_transfer' typo), case-insensitive column access, and validated required fields**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T20:44:35Z
- **Completed:** 2026-03-21T20:48:32Z
- **Tasks:** 3 (RED test, GREEN implementation, REFACTOR lint cleanup)
- **Files modified:** 2

## Accomplishments

- `ParsedFuturesTx` interface defined with all 9 futures_tx format columns: orderId, tradedAt, coin, futures, marginMode, rawType, amount, fee, walletBalance, sourceFile
- `parseFuturesTx(rows, filename)` function implemented with case-insensitive column access and required-field validation
- All 9 known Bitget futures transaction type strings accepted including the Bitget typo `risk_captital_user_transfer`
- 19 unit tests: one test per rawType, error cases for each required field, mixed valid/invalid rows, tab-stripping safety, sourceFile propagation

## Task Commits

Each task was committed atomically:

1. **RED - Failing tests** - `ec5ce6b` (test)
2. **GREEN + REFACTOR - Implementation + lint clean** - `c600767` (feat)

_Note: TDD plan — RED commit then GREEN+REFACTOR combined into one feat commit after lint cleanup_

## Files Created/Modified

- `packages/backend/src/import/parsers/futures-tx.ts` - ParsedFuturesTx interface, ParseFuturesTxResult type, parseFuturesTx function, lowerRow helper
- `packages/backend/src/import/parsers/futures-tx.test.ts` - 19 unit tests covering all 9 rawType strings, error cases, and edge cases

## Decisions Made

- **rawType stored as-is**: The parser does not map rawType to CanonicalType. The 9 known Bitget type strings are preserved verbatim. Normalization is responsibility of the type-map module (plan 02-07). This keeps the parser single-responsibility.
- **Both Futures and Coin as distinct fields**: The `futures` field holds the trading pair (e.g., 'POPCATUSDT'), `coin` holds the settlement asset (e.g., 'USDT'). These serve different purposes in tax calculation and must not be merged.
- **Bitget typo 'risk_captital_user_transfer' not corrected**: The raw CSV value has "captital" (two t's). The test explicitly verifies this exact spelling is preserved and that the corrected spelling 'risk_capital_user_transfer' is NOT stored. The type-map (02-07) must use the same typo.
- **lowerRow() helper for case-insensitive access**: Column names from csv-parse match the original CSV casing. Using a lowercase map prevents breakage if Bitget changes column casing in future exports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `lower()` helper function**

- **Found during:** GREEN phase, Biome lint check
- **Issue:** Initial implementation included both `lower()` and `lowerRow()` helpers; only `lowerRow()` was used
- **Fix:** Removed the unused `lower()` function to satisfy `lint/correctness/noUnusedVariables`
- **Files modified:** `packages/backend/src/import/parsers/futures-tx.ts`
- **Verification:** Biome check 0 issues, all 19 tests still pass
- **Committed in:** `c600767` (GREEN phase commit)

**2. [Rule 1 - Bug] Replaced forEach with for...of in test**

- **Found during:** GREEN phase, Biome lint check
- **Issue:** `transactions.forEach()` triggers `lint/complexity/noForEach`
- **Fix:** Replaced with `for...of` loop in sourceFile propagation test
- **Files modified:** `packages/backend/src/import/parsers/futures-tx.test.ts`
- **Verification:** Biome check 0 issues, test still passes
- **Committed in:** `c600767` (GREEN phase commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Biome lint corrections)
**Impact on plan:** Both fixes cosmetic/quality. No functional change. No scope creep.

## Issues Encountered

- `git add` failed on first attempt due to stale `.git/index.lock` (another process had it). Resolved by confirming lock file was already gone on second attempt — git succeeded immediately.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 02-04 (spot-order parser) can proceed independently: parsers are independent modules
- Plan 02-07 (normalization/type-map) can use `futures-tx.ts` as its input: `rawType` contains verbatim Bitget strings ready for CanonicalType mapping including the `risk_captital_user_transfer` typo
- All must-haves from plan 02-03 satisfied: `parseFuturesTx` exported, `ParsedFuturesTx` interface exported, all 9 rawType strings handled, both Futures and Coin columns captured

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
