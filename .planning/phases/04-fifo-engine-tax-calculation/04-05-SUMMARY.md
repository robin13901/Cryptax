---
phase: 04-fifo-engine-tax-calculation
plan: 05
subsystem: engine
tags: [earn, staking, fifo, tax, decimal.js, vitest, tdd, german-tax-law, paragraph-22-estg]

# Dependency graph
requires:
  - phase: 04-01
    provides: EngineTransaction, InMemoryLot, EarnIncomeResult types; ZERO constant; toDecimal/fromDecimal utilities
  - phase: 04-02
    provides: InMemoryLot shape and FIFO lot pattern established by spot engine
provides:
  - "runEarnIncomeEngine(transactions): EarnIncomeResult pure function"
  - "Earn income recording at EUR fair market value at Zufluss (§22 Nr. 3 EStG)"
  - "FIFO lot creation for earned coins (cost basis = fair market value at receipt)"
  - "earn_withdrawal skip logic (internal transfer, not taxable)"
affects:
  - "04-06: tax-calculator orchestrator — consumes EarnIncomeResult, applies 256 EUR annual Freigrenze cliff"
  - "04-07: DB persistence layer — persists incomeRecords and lotsCreated from this engine"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EARN_TAXABLE_TYPES Set: same O(1) filter pattern as FUTURES_TAXABLE_TYPES in 04-03"
    - "Dual output pattern: single engine pass produces both income records AND FIFO lots"
    - "Freigrenze deferred: per-transaction engine records raw income; orchestrator applies per-year cliff"
    - "ZERO constant from shared for feeEur (earn has no acquisition fee)"

key-files:
  created:
    - packages/backend/src/engine/earn-income-engine.ts
    - packages/backend/src/engine/earn-income-engine.test.ts
  modified: []

key-decisions:
  - "04-05: Freigrenze not applied in earn engine — deferred to orchestrator for per-year aggregate cliff check"
  - "04-05: earn_withdrawal skipped with specific reason message (distinguishes from generic non-earn skip)"
  - "04-05: FIFO lot feeEur = ZERO (earn has no acquisition cost beyond the fair market value)"
  - "04-05: costPerUnitEur = eurPrice directly (cost basis = fair market value at receipt, not inflated by fees)"

patterns-established:
  - "Set-based type guard: EARN_TAXABLE_TYPES = new Set([...]) — matches FUTURES_TAXABLE_TYPES pattern"
  - "lotIndex counter tracks position before DB insert (id = sentinel for not-yet-persisted)"
  - "Dual treatment: income record + lot created in single loop pass for each qualifying transaction"

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 4 Plan 5: Earn Income Engine Summary

**Pure earn income engine recording §22 Nr. 3 EStG income at EUR Zufluss value and creating FIFO lots with cost basis = fair market value at receipt**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T21:37:05Z
- **Completed:** 2026-03-22T21:40:22Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2

## Accomplishments

- `runEarnIncomeEngine` pure function filtering earn_interest and earn_deposit canonical types
- Dual output: income records (EUR value at Zufluss) + FIFO lots (cost basis = fair market value)
- earn_withdrawal explicitly skipped with descriptive reason (internal Bitget transfer)
- 9 test cases covering all specified behaviors, all passing; full suite 430 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing tests** - `f66f48a` (test)
2. **Task 2: GREEN — implementation** - `baca9d6` (feat)

_Note: TDD plan — 2 commits (test RED → feat GREEN)_

## Files Created/Modified

- `packages/backend/src/engine/earn-income-engine.ts` - Pure earn income engine, 105 lines
- `packages/backend/src/engine/earn-income-engine.test.ts` - 9 test cases, 242 lines

## Decisions Made

- **Freigrenze deferred to orchestrator:** The 256 EUR annual Freigrenze is a per-year aggregate cliff (if total earn income <= 256 EUR, taxable = 0; if > 256, full amount taxable). This cannot be applied per-transaction — the engine records raw income and the orchestrator (04-06) applies the cliff.
- **earn_withdrawal skip reason:** Specific message "earn_withdrawal is an internal Bitget transfer — not taxable" distinguishes from the generic "not an earn transaction" reason for other types. This aids debugging.
- **feeEur = ZERO:** Earn transactions have no acquisition fee — the cost basis is purely the fair market value at receipt. Using the shared ZERO constant (not new Decimal(0)) for consistency.
- **costPerUnitEur = eurPrice directly:** For earn lots, there is no fee adjustment to cost per unit (unlike buy lots where feeEur is added to cost basis). This matches German tax treatment where the income amount itself becomes the cost basis.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runEarnIncomeEngine` ready for consumption by tax-calculator orchestrator (04-06)
- EarnIncomeResult.lotsCreated feeds into the FIFO lot pool for future Haltefrist tracking
- 256 EUR Freigrenze cliff logic belongs in 04-06 orchestrator — aggregate per year then apply

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
