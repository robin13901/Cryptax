---
phase: 04-fifo-engine-tax-calculation
plan: 01
subsystem: engine
tags: [fifo, tax-engine, decimal.js, drizzle-orm, typescript, sqlite, vitest]

# Dependency graph
requires:
  - phase: 03-eur-price-enrichment
    provides: eurPrice column populated on transactions table, enrichment pipeline complete
  - phase: 01-foundation-ci-cd
    provides: Drizzle schema, SQLite setup, shared types package
provides:
  - HALTEFRIST_DAYS corrected to 366 (conservative German tax law interpretation)
  - Engine-internal types module (InMemoryLot, ConsumptionRecord, FifoEngineResult, etc.)
  - NullPriceError interface and checkNullPrices() pre-flight gate
  - Decimal import pattern fix for NodeNext module resolution
affects:
  - 04-02-fifo-lot-builder (uses InMemoryLot, Db type, TAXABLE_CANONICAL_TYPES)
  - 04-03-spot-tax-aggregator (uses ConsumptionRecord, SpotTaxResult)
  - 04-04-futures-engine (uses FuturesPnlResult, EngineTransaction)
  - 04-05-earn-income-engine (uses EarnIncomeResult)
  - 04-06-tax-orchestrator (uses TaxCalculationResult, checkNullPrices)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine types are in backend/src/engine/ (not shared) — in-memory processing only"
    - "Decimal import in NodeNext backend: use { Decimal } from 'decimal.js' (named export, not default)"
    - "inArray() with const array: cast as unknown as string[] to satisfy Drizzle types"
    - "Pre-flight gates return diagnostic arrays (not throw) — caller decides abort strategy"

key-files:
  created:
    - packages/backend/src/engine/types.ts
    - packages/backend/src/engine/null-price-gate.ts
    - packages/backend/src/engine/null-price-gate.test.ts
  modified:
    - packages/shared/src/constants/index.ts
    - packages/backend/src/prices/coingecko-client.ts
    - packages/backend/src/prices/resolution-strategy.ts

key-decisions:
  - "04-01: HALTEFRIST_DAYS=366 — conservative interpretation: Jan 1 buy is tax-free Jan 2 next year"
  - "04-01: Decimal import in NodeNext must be named export { Decimal } from 'decimal.js' — default import resolves to namespace only"
  - "04-01: checkNullPrices returns empty array on pass, array of NullPriceError on failure — caller decides abort"
  - "04-01: SKIPPABLE_CANONICAL_TYPES = transfer_in/out, earn_withdrawal, fee, unknown — intentionally excluded from NULL price check"

patterns-established:
  - "Engine module structure: packages/backend/src/engine/{module}.ts + {module}.test.ts"
  - "Pre-flight gate pattern: synchronous function returning diagnostic array, caller aborts if non-empty"
  - "Drizzle query in tests: applyMigrations() + drizzle(sqlite, { schema }) pattern (same as prices/ tests)"

# Metrics
duration: 14min
completed: 2026-03-22
---

# Phase 4 Plan 01: Engine Foundation and Null-Price Gate Summary

**HALTEFRIST_DAYS corrected to 366, engine-internal types defined, and pre-flight null-price gate with 8 passing tests blocks engine execution if any taxable transaction lacks an EUR price**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-22T21:08:07Z
- **Completed:** 2026-03-22T21:22:28Z
- **Tasks:** 2 completed
- **Files modified:** 6

## Accomplishments
- Updated HALTEFRIST_DAYS from 365 to 366 with conservative interpretation note (bought Jan 1 → tax-free Jan 2 next year)
- Created `engine/types.ts` with all required engine-internal interfaces: EngineTransaction, InMemoryLot, ConsumptionRecord, FifoEngineResult, SpotTaxResult, FuturesPnlResult, EarnIncomeResult, TaxCalculationResult, Db type alias
- Created `engine/null-price-gate.ts` with `checkNullPrices(db)` filtering to taxable canonical types only using Drizzle `and()` + `isNull()` + `inArray()`
- All 352 backend tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Update HALTEFRIST_DAYS and create engine types** - `eafe68a` (feat)
2. **Task 2: Implement null-price gate with tests** - `772ed20` (feat)

**Plan metadata:** committed below (docs)

## Files Created/Modified
- `packages/shared/src/constants/index.ts` - HALTEFRIST_DAYS: 365 → 366, updated JSDoc
- `packages/backend/src/engine/types.ts` - All engine-internal types (EngineTransaction, InMemoryLot, ConsumptionRecord, all result types, Db alias)
- `packages/backend/src/engine/null-price-gate.ts` - NullPriceError interface, checkNullPrices() function, TAXABLE/SKIPPABLE_CANONICAL_TYPES constants
- `packages/backend/src/engine/null-price-gate.test.ts` - 8 tests covering all paths (pass, single fail, multi-fail, skipped types)
- `packages/backend/src/prices/coingecko-client.ts` - Fixed Decimal import (pre-existing bug)
- `packages/backend/src/prices/resolution-strategy.ts` - Fixed Decimal import (pre-existing bug)

## Decisions Made
- HALTEFRIST_DAYS set to 366: the plan spec says 366 with conservative interpretation. A purchase on Jan 1 is tax-free from Jan 2 next year — that's 366 days elapsed, not 365.
- `checkNullPrices` returns diagnostic array rather than throwing: the caller (engine orchestrator) decides the abort strategy; this keeps the gate testable and pure.
- Decimal import fix: in NodeNext module resolution, `import { Decimal } from 'decimal.js'` (named export) is the only import form that resolves to the constructable class. Default import and `@cryptax/shared` re-export both resolve to the namespace.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TS2351 type errors in coingecko-client.ts and resolution-strategy.ts**
- **Found during:** Task 1 (HALTEFRIST_DAYS update and engine types creation)
- **Issue:** Both files used `import { Decimal } from '@cryptax/shared'` and called `new Decimal(...)`. In NodeNext module resolution with the shared package's compiled dist, `Decimal` was resolved as the namespace (not a constructor), causing TS2351 errors. The errors existed before this plan.
- **Fix:** Changed import to `import { Decimal } from 'decimal.js'` in both files (named export directly from decimal.js resolves to the class constructor)
- **Files modified:** `packages/backend/src/prices/coingecko-client.ts`, `packages/backend/src/prices/resolution-strategy.ts`
- **Verification:** `npx tsc --noEmit -p packages/backend/tsconfig.json` returns zero errors; all 352 tests pass
- **Committed in:** `eafe68a` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - pre-existing bug)
**Impact on plan:** The Decimal import fix was necessary to achieve the plan's stated goal of "both packages compile cleanly". Zero scope creep.

## Issues Encountered
- TypeScript NodeNext module resolution has a quirk with decimal.js: the default import (`import Decimal from 'decimal.js'`) picks up the merged namespace rather than the class constructor. Only the named import (`import { Decimal } from 'decimal.js'`) resolves correctly to the constructable class. Tested exhaustively before landing on this fix.
- Biome formatter required a long object literal in the test file to be reformatted to multi-line (auto-fixed with `biome check --write`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Engine types module is ready — all Phase 4 engine modules import from `./types.js`
- HALTEFRIST_DAYS = 366 is in place before any Haltefrist logic is written
- Null-price gate is a standalone callable — ready to be wired into the engine orchestrator (plan 04-06)
- Pre-existing type errors in prices/ are now fixed — clean TypeScript baseline for Phase 4

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
