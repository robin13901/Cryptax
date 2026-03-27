---
phase: 04-fifo-engine-tax-calculation
plan: 03
subsystem: engine
tags: [futures, pnl, tax, decimal, tdd, vitest, symbol-parser]

# Dependency graph
requires:
  - phase: 04-01
    provides: EngineTransaction type, FuturesPnlResult type, toDecimal/fromDecimal utilities
  - phase: 03-04
    provides: EUR price on all futures transactions via eurPrice field
provides:
  - runFuturesPnlEngine() pure function — futures P&L aggregation isolated from FIFO
  - Per-transaction P&L records for §20 EStG (Abgeltungssteuer) bucket
  - Strict isolation: zero FIFO lots created, zero cross-contamination with §23 EStG
affects:
  - 04-06 (tax summary aggregation — needs futures P&L results)
  - 04-08 (tax report output — futures bucket)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Set-based canonical type guard: FUTURES_TAXABLE_TYPES as Set<const> for O(1) filter"
    - "Futures fee sign convention: stored as positive abs() for clarity, even though source amounts are negative"
    - "Pure function engine pattern: no DB access, no side effects — takes array, returns result"

key-files:
  created:
    - packages/backend/src/engine/futures-pnl-engine.ts
    - packages/backend/src/engine/futures-pnl-engine.test.ts
  modified:
    - packages/shared/src/constants/index.test.ts
    - packages/backend/src/engine/fifo-engine.test.ts
    - packages/shared/src/constants/index.ts

key-decisions:
  - "Futures opens (futures_open_long/short) produce no taxable event — skipped with reason 'not a futures transaction'"
  - "Fee sign convention: feeEur stored as positive (abs of negative amount) for consistent reporting"
  - "FUTURES_TAXABLE_TYPES as const Set — guards both closed and funding types, excludes opens"

patterns-established:
  - "Pure engine pattern: runFuturesPnlEngine(transactions) returns {positions, skipped} — no DB access"
  - "Deviation rule: stale test values corrected when implementation truth conflicts with test assertion"

# Metrics
duration: 7min
completed: 2026-03-22
---

# Phase 4 Plan 03: Futures P&L Engine Summary

**Pure futures P&L engine processing §20 EStG close/fee/funding transactions with symbol normalization and strict isolation from FIFO lot tracking**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-22T21:26:50Z
- **Completed:** 2026-03-22T21:33:55Z
- **Tasks:** 1 TDD task (RED + GREEN phases)
- **Files modified:** 5

## Accomplishments

- `runFuturesPnlEngine()` pure function processes all futures canonical types and returns per-transaction P&L records
- Complete §20 EStG bucket isolation — no FIFO lots created, no Haltefrist logic
- 10 tests all green covering closes, losses, fees (positive abs), funding (both signs), skipped opens, non-futures skipped, symbol normalization, multi-symbol batches

## Task Commits

TDD task with two atomic commits:

1. **RED - Failing tests** - `4f35314` (test)
2. **GREEN - Implementation** - `806066a` (feat, includes deviation fixes)

## Files Created/Modified

- `packages/backend/src/engine/futures-pnl-engine.ts` - Pure futures P&L engine, `runFuturesPnlEngine()` export
- `packages/backend/src/engine/futures-pnl-engine.test.ts` - 10 tests covering all processing rules
- `packages/shared/src/constants/index.test.ts` - Fixed stale HALTEFRIST_DAYS assertion (365 → 366)
- `packages/backend/src/engine/fifo-engine.test.ts` - Fixed leap-year date boundary (2024 has 366 days, not 365)
- `packages/shared/src/constants/index.ts` - Biome formatting fix (CRLF → LF)

## Decisions Made

- Futures opens (`futures_open_long`, `futures_open_short`) are skipped with reason "not a futures transaction" — opening a position creates no taxable event under German law
- Fee amounts from source data are negative (e.g., `-2.5 USDT`); stored as positive via `.abs()` for consistent downstream reporting
- `FUTURES_TAXABLE_TYPES` as a `Set<const>` for O(1) type guard — clean and explicit over switch/if chains

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale TAX_CONSTANTS.HALTEFRIST_DAYS test assertion**
- **Found during:** Full test suite regression check after GREEN phase
- **Issue:** `packages/shared/src/constants/index.test.ts` asserted `HALTEFRIST_DAYS === 365` but the implementation was changed to 366 in plan 04-01 (conservative interpretation decision). Test was never updated.
- **Fix:** Updated test assertion from `toBe(365)` to `toBe(366)` with explanatory comment
- **Files modified:** `packages/shared/src/constants/index.test.ts`
- **Verification:** Full test suite passes (407/407)
- **Committed in:** `806066a` (GREEN phase commit)

**2. [Rule 1 - Bug] Fixed fifo-engine.test.ts leap-year date boundary error**
- **Found during:** Full test suite regression check after GREEN phase
- **Issue:** Test "365 days = not exempt" used `2024-01-01 → 2025-01-01` but 2024 is a leap year (366 days), so `differenceInCalendarDays` returns 366, not 365. With `HALTEFRIST_DAYS=366`, this resulted in `haltefristMet=true` when the test expected `false`.
- **Fix:** Changed buy date to `2023-01-01` and sell date to `2024-01-01` (2023 is not a leap year, difference is exactly 365 days, correctly below the 366-day threshold)
- **Files modified:** `packages/backend/src/engine/fifo-engine.test.ts`
- **Verification:** Test now correctly asserts `haltefristMet=false` for 365 days
- **Committed in:** `806066a` (GREEN phase commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary for test suite correctness. No scope creep — these were latent test bugs introduced by earlier plan decisions that weren't propagated to test expectations.

## Issues Encountered

None — the plan executed cleanly. The two test fixes were pre-existing bugs in test assertions, not issues in the futures engine implementation.

## Next Phase Readiness

- Futures P&L engine complete and tested — ready for plan 04-04 (Earn income engine)
- `runFuturesPnlEngine` pure function is ready to be composed into the top-level `TaxCalculationResult` in plan 04-06
- No blockers

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
