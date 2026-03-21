---
phase: 02-csv-import-pipeline
plan: 05
subsystem: import
tags: [csv, parsing, futures, tdd, typescript, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: ImportFileError type from @cryptax/shared, parsers directory structure

provides:
  - parseFuturesOrder function accepting pre-parsed CSV rows
  - ParsedFuturesOrder interface covering all 15 futures order history columns
  - Unit tests for all 4 Direction values, Market order edge case, required field validation

affects:
  - 02-06 (detect-format: recognises futures_order by 'netprofits' + 'realized p/l' headers)
  - 02-07 (normalize: uses parseFuturesOrder and ParsedFuturesOrder for normalisation)
  - phase-04-fifo-engine (realizedPnl and netProfits fields captured for PnL computation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Map-based normalised key lookup for CSV columns with spaces and special chars (realized p/l)
    - Average Price optional field pattern (empty string, not error) for Market orders
    - Required-field-first validation with continue — skip invalid rows, accumulate errors

key-files:
  created:
    - packages/backend/src/import/parsers/futures-order.ts
    - packages/backend/src/import/parsers/futures-order.test.ts
  modified: []

key-decisions:
  - "02-05: Average Price stored as empty string (not null) for Market futures orders — matches string union type and avoids null checks in downstream"
  - "02-05: Map-based normalised column lookup used (not direct row[key]) — handles 'realized p/l' slash and 'order source' lowercase without Biome useLiteralKeys complaints"
  - "02-05: parseFuturesOrder receives pre-tokenised rows (trim already applied by csv-parse) — still trims in get() for safety when rows arrive from tests"

patterns-established:
  - "Futures parser pattern: normaliseRow() → Map → get(map, 'key') for all column access"
  - "TDD RED commit before implementation, GREEN commit after all tests pass"

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 2 Plan 05: Futures Order History Parser Summary

**parseFuturesOrder function with Map-based normalised key lookup, handling 15-column futures order CSV including empty Average Price for Market orders and realizedPnl/netProfits capture for Phase 4 PnL tracking**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T20:44:39Z
- **Completed:** 2026-03-21T20:48:20Z
- **Tasks:** TDD (RED + GREEN)
- **Files modified:** 2

## Accomplishments

- `ParsedFuturesOrder` interface with all 15 CSV column fields including `realizedPnl` and `netProfits`
- `parseFuturesOrder` function with required field validation (Order ID, Date, Direction) and graceful error accumulation
- Average Price intentionally optional — empty string accepted for Market orders at open (not an error)
- All 4 Direction values covered: Open long, Close long, Open short, Close short
- 17 tests passing; full suite (128 tests) clean

## Task Commits

TDD cycle (2 commits):

1. **RED — failing tests** - `088179a` (test)
2. **GREEN — implementation + Biome import order fix** - `9e14ee6` (feat)

**Plan metadata:** (to be committed with docs commit)

_Note: TDD tasks produce test → feat commits per workflow._

## Files Created/Modified

- `packages/backend/src/import/parsers/futures-order.ts` — ParsedFuturesOrder interface and parseFuturesOrder function (111 lines)
- `packages/backend/src/import/parsers/futures-order.test.ts` — 17 unit tests across 6 describe blocks (211 lines)

## Decisions Made

- **Average Price as empty string:** Futures Market orders have no Average Price at order open. Storing `''` (not `null`) keeps the field typed as `string` throughout, avoiding null-checks in downstream normalisation.
- **Map-based key lookup:** Column names like `'realized p/l'`, `'order source'`, and `'netprofits'` include characters that would trigger Biome's `useLiteralKeys` rule if accessed via `row['realized p/l']` on a `Record<string,string>`. Using a `Map<string,string>` with a `get()` helper avoids this completely.
- **Trim in get() helper:** Although csv-parse's `trim:true` handles tabs before rows reach this parser, the `get()` helper still calls `.trim()` on extracted values. This ensures correctness for test rows that pass raw strings with accidental whitespace.

## Deviations from Plan

None — plan executed exactly as written. The import ordering fix in the test file was a Biome `organizeImports` requirement, not a deviation.

## Issues Encountered

- Biome `organizeImports` requires `type` imports to be grouped after external-package imports but before same-package value imports. Fixed by reordering to: `vitest` → `type ParsedFuturesOrder` → `parseFuturesOrder`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `parseFuturesOrder` and `ParsedFuturesOrder` are ready for use in:
  - `detect-format.ts` (plan 02-06): `'netprofits'` + `'realized p/l'` header signature identifies this format
  - `normalize.ts` (plan 02-07): maps `ParsedFuturesOrder.rawType` to `CanonicalType` via type map
  - Phase 4 FIFO engine: `realizedPnl` and `netProfits` fields available for futures PnL computation

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
