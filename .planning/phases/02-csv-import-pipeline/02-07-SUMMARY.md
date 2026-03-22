---
phase: 02-csv-import-pipeline
plan: 07
subsystem: import
tags: [csv-parse, sha256, format-detection, canonical-type-mapping, normalization, bitget]

# Dependency graph
requires:
  - phase: 02-02
    provides: parseSpotTx parser (spot_tx format)
  - phase: 02-03
    provides: parseSpotOrder parser (spot_order format)
  - phase: 02-04
    provides: parseFuturesTx parser (futures_tx format)
  - phase: 02-05
    provides: parseFuturesOrder parser (futures_order format)
  - phase: 02-06
    provides: parseEarn parser (earn format)
provides:
  - detectDelimiter: semicolon vs comma detection from header line
  - detectFormat: 5-format signature detection (BOM-aware, delimiter-aware)
  - parseRawCSV: full orchestration (delimiter detect -> format detect -> csv-parse)
  - computeChecksum: SHA-256 of JSON.stringify(row) for dedup
  - CANONICAL_TYPE_MAP: all 22 raw Bitget type strings -> CanonicalType
  - mapCanonicalType: case-sensitive lookup with 'unknown' fallback
  - normalizeToTransaction: per-format row -> transactions.$inferInsert
  - index.ts barrel: unified import for all modules
affects: ["02-08", "03-insert-layer", "insert.ts"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Format detection: most-specific-first column signature matching (earn, futures_order, spot_order, futures_tx, spot_tx)"
    - "Delimiter detection runs BEFORE format detection — critical for 2024 semicolon vs 2025 comma spot files"
    - "Checksum: JSON.stringify(row) -> SHA-256 hex — deterministic because csv-parse preserves column order"
    - "Normalization: price/totalValue default '0' for formats without those columns (NOT NULL DB constraint)"
    - "Side derivation: canonical type -> buy/sell/null mapping"

key-files:
  created:
    - packages/backend/src/import/detect-format.ts
    - packages/backend/src/import/detect-format.test.ts
    - packages/backend/src/import/parse-csv.ts
    - packages/backend/src/import/parse-csv.test.ts
    - packages/backend/src/import/checksum.ts
    - packages/backend/src/import/checksum.test.ts
    - packages/backend/src/import/type-map.ts
    - packages/backend/src/import/type-map.test.ts
    - packages/backend/src/import/normalize.ts
    - packages/backend/src/import/normalize.test.ts
    - packages/backend/src/import/index.ts
  modified: []

key-decisions:
  - "checksum uses JSON.stringify(row) not Object.values().join('|') — safer for values containing '|' characters"
  - "deriveSide treats close_short as 'buy' side and close_long as 'sell' side (closing a short = buying back)"
  - "normalizeToTransaction takes the raw csv-parse row (not the parser-specific typed row) — simplest approach"
  - "index.ts barrel organizes exports alphabetically by function name (Biome organizeImports)"

patterns-established:
  - "All import modules work directly on csv-parse output (Record<string, string>) using lowercase key normalization"
  - "Type imports via 'import type' for all schema/type-only references — enforced by Biome"

# Metrics
duration: 12min
completed: 2026-03-21
---

# Phase 02 Plan 07: Format Detector + Normalizer Summary

**Format detection, canonical type mapping, and normalization pipeline connecting all 5 Bitget CSV parsers to DB-ready transaction objects — 210 tests across 10 test files.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-21T20:54:13Z
- **Completed:** 2026-03-21T21:06:29Z
- **Tasks:** 2/2
- **Files modified:** 11 created, 0 modified

## Accomplishments

- Built `detectFormat` with correct most-specific-first order (earn + futures_order checked before spot_order and futures_tx to avoid false column overlaps)
- `detectDelimiter` runs before `detectFormat` — the only way 2024 semicolon spot files and 2025 comma spot files can both be correctly identified as `spot_tx`
- `CANONICAL_TYPE_MAP` covers all 22 raw Bitget type strings across 5 formats, including Bitget's exact typo `risk_captital_user_transfer` (preserved verbatim)
- `normalizeToTransaction` produces valid `transactions.$inferInsert` objects for all 5 formats — price and totalValue default to `'0'` (NOT NULL schema constraint)
- All modules exported via clean barrel `index.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Format detection, CSV parsing, checksum** - `849cb2a` (feat)
2. **Task 2: Canonical type map, normalization, barrel index** - `c789861` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `/packages/backend/src/import/detect-format.ts` — detectDelimiter + detectFormat
- `/packages/backend/src/import/detect-format.test.ts` — 16 tests covering BOM, all 5 formats, delimiter variants
- `/packages/backend/src/import/parse-csv.ts` — parseRawCSV orchestrator
- `/packages/backend/src/import/parse-csv.test.ts` — 17 tests covering BOM, trim, empty lines, all 5 formats
- `/packages/backend/src/import/checksum.ts` — SHA-256 computeChecksum
- `/packages/backend/src/import/checksum.test.ts` — 7 tests (determinism, length, hex format)
- `/packages/backend/src/import/type-map.ts` — CANONICAL_TYPE_MAP + mapCanonicalType
- `/packages/backend/src/import/type-map.test.ts` — 38 tests (all 22 mappings explicitly + unknown + case sensitivity)
- `/packages/backend/src/import/normalize.ts` — normalizeToTransaction (all 5 formats)
- `/packages/backend/src/import/normalize.test.ts` — 35 tests (all formats, unknown types, taxYear, side derivation)
- `/packages/backend/src/import/index.ts` — barrel export for all 5 modules

## Decisions Made

1. **checksum uses JSON.stringify(row)** — safer than `Object.values().join('|')` for values that might contain the pipe separator. SHA-256 produces 64-char hex string.

2. **deriveSide for futures close_short -> 'buy'** — closing a short position means buying back the contract. Similarly close_long -> 'sell' (liquidating a long = selling). This follows futures market semantics.

3. **normalizeToTransaction receives raw csv-parse rows** — rather than typed parser objects (ParsedSpotTx etc.), the normalizer works directly on `Record<string, string>` rows. This keeps it decoupled from the individual parsers and consistent with the pipeline design.

4. **price defaults to '0' not null** — the DB schema has `price text NOT NULL`. Formats without price columns (spot_tx, futures_tx, earn) use '0' as the sentinel value. Phase 3+ will enrich with EUR prices from the price API.

5. **Biome organizeImports applies to barrel exports** — alphabetical ordering: checksum < detect-format < normalize < parse-csv < type-map.

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

- **02-08 (Insert Layer):** Can import from `@cryptax/backend/import` to get `parseRawCSV`, `normalizeToTransaction`, and all parser functions. The full pipeline (parse -> normalize -> insert) is ready to wire up.
- All normalized objects conform to `typeof transactions.$inferInsert` — TypeScript compilation confirmed.
- 210 tests pass across the full import module suite.
