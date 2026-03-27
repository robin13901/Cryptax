---
phase: 05-dashboard-transaction-ui
plan: "01"
subsystem: api-layer
tags: [hono, drizzle, sqlite, summary-api, kpi, dashboard, freigrenze]

dependency-graph:
  requires:
    - "04-fifo-engine-tax-calculation (taxSummaries, lotConsumptions, fifoLots, futuresPositions, earnIncome populated by engine)"
  provides:
    - "GET /api/summary/:year — complete YearSummaryResponse for dashboard tab"
    - "YearSummaryResponse shared type exported from @cryptax/shared"
  affects:
    - "05-02 (dashboard frontend KPI cards consume /api/summary/:year)"
    - "05-03 (portfolio chart consumes portfolioAllocation)"
    - "05-04 (per-coin chart consumes perCoinGainLoss)"
    - "05-05 (monthly charts consume monthlySpot, monthlyFutures)"
    - "05-06 (futures chart consumes monthlyFutures)"

tech-stack:
  added: []
  patterns:
    - "engineHasRun guard: query tax_summaries.limit(1) to distinguish engine-not-run from zero-gains"
    - "SQL pivot via Map for year-over-year bucket aggregation"
    - "Portfolio allocation uses CAST(remainingAmount AS REAL) > 0 filter in SQLite"

file-tracking:
  created:
    - packages/shared/src/types/summary.ts
    - packages/backend/src/routes/summary.ts
    - packages/backend/src/routes/summary.test.ts
  modified:
    - packages/shared/src/index.ts
    - packages/backend/src/index.ts

decisions:
  - id: "05-01-a"
    decision: "engineHasRun check uses SELECT 1 FROM tax_summaries LIMIT 1 — cheapest possible probe"
    rationale: "Avoids full table scan; distinguishes no-engine-run from zero-gains year cleanly"
  - id: "05-01-b"
    decision: "Portfolio allocation is year-agnostic — shows current open holdings across all tax years"
    rationale: "Current portfolio state transcends any single tax year; open lots from 2022 are still relevant in 2024 view"
  - id: "05-01-c"
    decision: "sumStrings helper uses parseFloat + sum — acceptable precision for display aggregation"
    rationale: "KPI totals are already stored as pre-computed strings from the engine; simple float sum is sufficient for dashboard display"

metrics:
  duration: "6 minutes"
  completed: "2026-03-23"
  tests-added: 23
  tests-total: 532
---

# Phase 05 Plan 01: Summary API Summary

**One-liner:** Single `GET /api/summary/:year` endpoint returning KPIs, chart datasets, Freigrenze status, and portfolio allocation from real DB data, with `engineHasRun=false` guard for pre-engine-run state.

## What Was Built

The dashboard data backbone: a single endpoint that delivers all pre-computed tax summary data plus aggregated chart data needed by the frontend Dashboard tab.

**Key files:**
- `/packages/shared/src/types/summary.ts` — `YearSummaryResponse` interface (buckets, KPIs, 5 chart datasets, Freigrenze fields)
- `/packages/backend/src/routes/summary.ts` — `registerSummaryRoutes` with complete query logic
- `/packages/backend/src/routes/summary.test.ts` — 23 tests across all response shapes

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create YearSummaryResponse shared type | 51280e6 | packages/shared/src/types/summary.ts, packages/shared/src/index.ts |
| 2 | Implement GET /api/summary/:year route with tests | 2f01b6c | packages/backend/src/routes/summary.ts, summary.test.ts, index.ts |

## Route Behavior

### GET /api/summary/:year

**Query flow:**
1. Parse year, return 400 if NaN
2. `SELECT 1 FROM tax_summaries LIMIT 1` — if empty, return `engineHasRun: false` with zero values
3. `SELECT DISTINCT tax_year FROM tax_summaries` → `availableYears`
4. `SELECT * FROM tax_summaries WHERE tax_year = ?` → `buckets`
5. Aggregate `totalNetEur`, `totalTradeCount`, `totalTaxableEur`, `totalEstimatedTaxEur` from buckets
6. JOIN `lot_consumptions → transactions`, group by `strftime('%Y-%m')` → `monthlySpot`
7. JOIN `futures_positions → transactions`, group by `strftime('%Y-%m')` → `monthlyFutures`
8. JOIN `lot_consumptions → fifo_lots`, group by `symbol` → `perCoinGainLoss`
9. `SELECT FROM fifo_lots WHERE remainingAmount > 0` → `portfolioAllocation` (no year filter)
10. `SELECT * FROM tax_summaries` pivot by bucket into `yearOverYear`
11. Extract `spotNetForFreigrenze` from `private_sale.netEur`, `earnTotalForFreigrenze` from `staking_earn.netEur`

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| engineHasRun probe | `SELECT 1 FROM tax_summaries LIMIT 1` | Cheapest DB probe; cleanly separates "never ran" from "ran with zero gains" |
| Portfolio year filter | None — all years | Portfolio shows current holdings state; open lots from past years remain relevant |
| KPI aggregation | `parseFloat` sum | Engine already stores precise Decimal strings; simple float sum is adequate for display |
| Year-over-year pivot | In-memory Map groupBy | Simpler than SQL CASE WHEN pivot; tax_summaries is always small (<100 rows) |

## Test Coverage

23 tests across 7 describe blocks:
- Input validation (400 for non-numeric year)
- `engineHasRun=false` state (empty arrays, zero values, Freigrenze constants still present)
- Buckets and KPIs (correct filtering by year, aggregation math)
- Available years (all years returned, even if requested year has no data)
- Monthly spot data (correct YYYY-MM grouping, gains/losses split)
- Portfolio allocation (remainingAmount > 0 filter, value calculation, year-agnostic)
- Freigrenze (spotNetForFreigrenze from private_sale, earnTotalForFreigrenze from staking_earn)
- Year-over-year (all years included, sorted ascending)

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

Phase 05-02 (Dashboard KPI cards) can proceed immediately. The `YearSummaryResponse` type is exported from `@cryptax/shared` and `GET /api/summary/:year` is registered and returning real data.

No blockers.
