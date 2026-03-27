---
phase: 04-fifo-engine-tax-calculation
plan: 06
subsystem: engine
tags: [tax-calculator, fifo, orchestrator, drizzle, sqlite, stateless, §23, §20, §22, freigrenze, abgeltungssteuer]

# Dependency graph
requires:
  - phase: 04-01
    provides: null-price gate, EngineTransaction type, HALTEFRIST_DAYS constant
  - phase: 04-02
    provides: runFifoEngine — FIFO lot creation and consumption
  - phase: 04-03
    provides: runFuturesPnlEngine — §20 futures P&L positions
  - phase: 04-04
    provides: calculateSpotTax — §23 per-year aggregation with Freigrenze
  - phase: 04-05
    provides: runEarnIncomeEngine — §22 Nr. 3 income records + FIFO lots
provides:
  - runTaxCalculation(db) orchestrator that coordinates all 4 engines
  - Stateless truncate-and-recompute semantics (idempotent)
  - Three isolated tax buckets written to tax_summaries per year
  - Earn FIFO lots merged into spot lot pool for cross-year continuity
  - 8-step pipeline: gate → load → truncate → earn → FIFO → futures → spot-tax → summaries
affects: [04-07, 04-08, api-layer, frontend-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Stateless orchestrator: truncate all derived tables then recompute from source transactions
    - Synthetic buy transactions: earn transactions converted to canonicalType='buy' for FIFO engine input
    - Single DB transaction wraps all writes (truncate + inserts + summaries) for atomicity
    - lotIndex → DB ID mapping: insert lots first, collect auto-increment IDs, use when inserting consumptions

key-files:
  created:
    - packages/backend/src/engine/tax-calculator.ts
    - packages/backend/src/engine/tax-calculator.test.ts
  modified: []

key-decisions:
  - "04-06: Earn lots fed into FIFO via synthetic buy transactions (canonicalType='buy') — earn engine still runs separately for §22 income records"
  - "04-06: §23 estimatedTaxEur = 0 — marginal rate unknown; only Abgeltungssteuer (futures, 26.375%) is computable without user tax data"
  - "04-06: Earn Freigrenze cliff at 256 EUR applied at orchestrator level per-year aggregate (deferred from earn engine per 04-05 decision)"
  - "04-06: Futures net P&L = sum(realizedPnlEur) - sum(feeEur) per year; only positive net is taxable (no Freigrenze)"
  - "04-06: DB writes inside single db.transaction() — atomic: either all 5 tables written or none"

patterns-established:
  - "Orchestrator pattern: pure engines compute in-memory, orchestrator handles DB truncate+write"
  - "Tax bucket isolation: private_sale / futures_pnl / staking_earn never share rows in tax_summaries"

# Metrics
duration: 7min
completed: 2026-03-22
---

# Phase 4 Plan 06: TaxCalculator Orchestrator Summary

**Stateless truncate-and-recompute orchestrator wiring all 4 engines (FIFO, futures, earn, spot-tax) into a single pipeline that writes 5 derived tables and generates per-year §23/§20/§22 tax summaries with correct Freigrenze and Abgeltungssteuer application.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-22T21:44:14Z
- **Completed:** 2026-03-22T21:51:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented `runTaxCalculation(db)` as the central pipeline coordinator — 8 steps from NULL price gate to summary generation
- Earn lots correctly merge into the spot FIFO pool via synthetic buy transactions, enabling cross-year continuity (earn in 2024, sell in 2025)
- Three tax buckets (private_sale/§23, futures_pnl/§20, staking_earn/§22) written as isolated rows per year with mathematically correct tax computations
- 8 integration tests cover all edge cases including idempotency, cross-year lots, and the 256 EUR earn Freigrenze cliff

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement TaxCalculator orchestrator** - `8bd8833` (feat)
2. **Task 2: Write orchestrator integration tests** - `bf4985d` (test)

## Files Created/Modified

- `packages/backend/src/engine/tax-calculator.ts` — Main orchestrator (259 lines): null-price gate, truncate, engine dispatch, DB writes, summary generation
- `packages/backend/src/engine/tax-calculator.test.ts` — 8 integration tests with in-memory SQLite (503 lines)

## Decisions Made

- **Earn lots via synthetic buys**: Earn transactions are duplicated as `canonicalType='buy'` entries fed into runFifoEngine. The earn engine still runs separately for §22 income records. This avoids changing the FIFO engine's interface while enabling cross-year disposal tracking.
- **§23 estimatedTaxEur = 0**: Private sale tax depends on the user's marginal income tax rate, which is unknown. Only futures Abgeltungssteuer (26.375%) is computed automatically.
- **Earn Freigrenze deferred here**: Per 04-05 decision, the earn engine returns raw income totals; the orchestrator applies the 256 EUR cliff per-year across all earn transactions for that year.
- **Single db.transaction() wraps all writes**: Truncate + inserts + summaries are atomic. A crash mid-run leaves the DB in its prior state.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Biome formatter flagged chained `.insert()` call indentation and import sort order — auto-fixed with `biome check --write`. Zero test impact.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `runTaxCalculation` is fully implemented and tested — ready for the HTTP API layer (04-07)
- All 5 derived tables (fifo_lots, lot_consumptions, futures_positions, earn_income, tax_summaries) are populated correctly
- Stateless design means the API can call runTaxCalculation on demand without worrying about stale state
- 409 backend tests pass, zero regressions

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
