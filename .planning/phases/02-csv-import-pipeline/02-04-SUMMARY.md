---
phase: 02-csv-import-pipeline
plan: 04
subsystem: import
tags: [csv, parser, tdd, spot-order, bitget, typescript, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: ImportFileError type from @cryptax/shared, csv-parse installed, shared import types
provides:
  - parseSpotOrder() function for Bitget spot order history CSV rows
  - ParsedSpotOrder interface with 13 typed fields
affects:
  - 02-07 (normalize step will use ParsedSpotOrder to produce NormalizedTransaction)
  - 02-08 (import orchestrator wires all parsers together)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED-GREEN-REFACTOR cycle: test file committed first (failing), then implementation committed green"
    - "Lowercase key normalisation map: build `norm` Record once per row, access with dot or bracket notation"
    - "1-based row error numbering: row number = array index + 1 for user-facing error messages"
    - "Single required-field error per row: break on first missing field to avoid noisy multi-error per row"

key-files:
  created:
    - packages/backend/src/import/parsers/spot-order.ts
    - packages/backend/src/import/parsers/spot-order.test.ts
  modified: []

key-decisions:
  - "Average Price (not Price column) used for price field — spot order history has both; Average Price is the fill price, Price is the limit order price"
  - "Direction column mapped to rawType (not Type column) — Type in spot order history is Limit/Market; Direction is Buy/Sell"
  - "Symbol derived as baseAsset + '/' + quoteAsset — not from Trading pair column which lacks the slash separator"
  - "Biome useLiteralKeys: single-word normalised keys use dot notation (norm.date), multi-word keys stay bracket notation (norm['order id'])"

patterns-established:
  - "Parser signature: parseXxx(rows: Record<string, string>[], filename: string): { transactions: ParsedXxx[], errors: ImportFileError[] }"
  - "Fixture helpers (makeBuyRow/makeSellRow) with overrides parameter for concise test variations"

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 2 Plan 4: Spot Order History Parser Summary

**TDD-built parseSpotOrder() that maps Bitget spot order history CSV rows to ParsedSpotOrder objects, deriving symbol from Base/Quote Asset columns and using Average Price as the fill price**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T20:44:35Z
- **Completed:** 2026-03-21T20:48:14Z
- **Tasks:** 1 (TDD: RED + GREEN + lint fix)
- **Files created:** 2

## Accomplishments

- Defined `ParsedSpotOrder` interface with all 13 typed fields matching the Bitget spot order history CSV schema
- `parseSpotOrder()` validated 5 required fields, builds lowercase normalisation map per row, derives symbol from Base Asset + '/' + Quote Asset
- Average Price used for `price` field (not the `Price` column which is the limit order price, not the fill price)
- Direction column captured as `rawType` (Buy/Sell), Type column captured as `orderType` (Limit/Market)
- Tab-stripped Order Id via `.trim()` in the normalisation loop
- 22 tests covering Buy/Sell orders, partial fills, missing field errors, tab-stripping, multi-row batches

## Task Commits

TDD commits (RED then GREEN):

1. **RED - Failing tests** - `4bff0f5` (test(02-04): add failing tests for spot order history parser)
2. **GREEN - Implementation + lint fix** - `12b7304` (feat(02-04): implement spot order history CSV parser)

## Files Created/Modified

- `packages/backend/src/import/parsers/spot-order.ts` - ParsedSpotOrder interface and parseSpotOrder() function (109 lines)
- `packages/backend/src/import/parsers/spot-order.test.ts` - 22 unit tests covering all cases (308 lines)

## Decisions Made

- **Average Price vs Price column:** The spot order history CSV has two price columns. `Price` is the limit order entry price; `Average Price` is the actual fill price (execution weighted average). The `price` field must use Average Price for accurate cost basis.
- **Direction as rawType:** The `Type` column in this format means order type (Limit/Market), not trade direction. Direction (Buy/Sell) is the field that maps to canonical buy/sell classification — stored as `rawType`.
- **Symbol derivation:** `Trading pair` column concatenates assets without separator (e.g., `BTCEUR`). Using `Base Asset + '/' + Quote Asset` produces the standard `BTC/EUR` format expected by the normalisation layer.
- **Biome dot notation rule:** Biome `useLiteralKeys` rule requires dot notation for single-word keys on the normalised map. Multi-word keys (`order id`, `average price`, `order amount`, `base asset`, `quote asset`, `trading volume`) must stay as bracket notation.

## Deviations from Plan

None - plan executed exactly as written. The only post-implementation work was applying Biome's `useLiteralKeys` lint rule (dot notation for single-word keys), which was an expected formatting step per project conventions.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `parseSpotOrder()` is ready for use in the import orchestrator (02-08)
- `ParsedSpotOrder` interface is ready for the normalisation layer (02-07) which maps it to `NormalizedTransaction`
- All 128 project tests pass (8 test files)

---
*Phase: 02-csv-import-pipeline*
*Completed: 2026-03-21*
