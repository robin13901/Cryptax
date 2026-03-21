---
phase: 02-csv-import-pipeline
plan: "06"
subsystem: import
tags: [csv, parser, earn, staking, tdd, vitest, typescript]

# Dependency graph
requires:
  - phase: 02-csv-import-pipeline
    provides: "ImportFileError type from @cryptax/shared (02-01)"

provides:
  - "parseEarn(rows, filename) function for on-chain earn CSV rows"
  - "ParsedEarn interface with all 8 earn CSV fields typed"

affects:
  - 02-csv-import-pipeline (normalize.ts, type-map.ts)
  - Phase 3+ (FIFO / earn income classification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED-GREEN pattern: test commit before implementation commit"
    - "Column key normalisation to lowercase for csv-parse robustness"
    - "Required field validation with row-level errors (continue-on-error)"

key-files:
  created:
    - packages/backend/src/import/parsers/earn.ts
    - packages/backend/src/import/parsers/earn.test.ts
  modified: []

key-decisions:
  - "02-06: earn Reference column requires no tab stripping — csv-parse trim: true is a no-op on already-clean fields; normaliseRow() handles both cased and lowercased keys"
  - "02-06: ParsedEarn keeps coin (staked asset) and interestCoin (received asset) as separate fields — both needed for tax classification"

patterns-established:
  - "normaliseRow() helper: lowercase all keys before field access — handles csv-parse output regardless of casing"
  - "field() helper: safe trim with undefined/null guard — consistent across all parsers"

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 2 Plan 06: On-chain Earn Parser Summary

**parseEarn() with 16 tests — parses 8-column earn CSV into ParsedEarn objects with clean reference handling and separate coin/interestCoin fields**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-21T20:44:51Z
- **Completed:** 2026-03-21T20:47:58Z
- **Tasks:** 2 (RED + GREEN, no REFACTOR needed)
- **Files modified:** 2

## Accomplishments

- `parseEarn(rows, filename)` returns `{ transactions: ParsedEarn[], errors: ImportFileError[] }` with row-level validation
- Reference column captured without tab stripping (earn is the only Bitget format with clean numeric IDs)
- `coin` (staked asset) and `interestCoin` (received asset) captured separately for correct tax mapping
- 16 tests covering: field mapping, reference cleanliness, interest/coin separation, amount, fee, status, multi-row, error cases, and lowercase key normalisation

## Task Commits

Each task was committed atomically:

1. **RED — Failing test file** - `1c80e4d` (test)
2. **GREEN — Implementation + Biome fix** - `e0b5ec5` (feat)

_Note: TDD tasks produce separate test and feat commits per RED-GREEN cycle_

## Files Created/Modified

- `packages/backend/src/import/parsers/earn.ts` - `parseEarn` function and `ParsedEarn` interface (120 lines)
- `packages/backend/src/import/parsers/earn.test.ts` - 16 unit tests (223 lines)

## Decisions Made

- **Column key normalisation at parse time:** `normaliseRow()` converts all keys to lowercase so the parser works regardless of whether csv-parse preserved the original casing (e.g., `'Interest coin'` vs `'interest coin'`). This was not in the plan spec but is required for the lowercase-key test case to pass.
- **No tab-strip needed:** The earn Reference field arrives clean. The `field()` helper calls `.trim()` which is safe as a no-op if csv-parse already handled it.

## Deviations from Plan

None — plan executed exactly as written. The `normaliseRow()` helper was identified in the `<implementation>` guidance (step 3: "Normalize column keys to lowercase") and implemented as specified.

## Issues Encountered

- Biome `organizeImports` rule required `import type` before value imports from the same module. Fixed manually (Biome `--write` only applies formatter, not `organizeImports` assist rule).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `parseEarn` is ready for use in `normalize.ts` (02-07) and the import orchestrator
- All 5 parser modules (spot-tx, futures-tx, spot-order, futures-order, earn) should now be complete
- Ready to proceed with format detection, normalisation, and batch insert phases

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
