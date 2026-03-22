---
phase: 04-fifo-engine-tax-calculation
plan: "04"
subsystem: engine
tags: [decimal.js, tax-calculation, haltefrist, freigrenze, tdd, vitest]

# Dependency graph
requires:
  - phase: 04-02
    provides: "ConsumptionRecord type and FIFO engine output"
  - phase: 04-01
    provides: "TAX_CONSTANTS.SPOT_FREIGRENZE_EUR, engine types, Decimal utilities"
provides:
  - "calculateSpotTax pure function — aggregates ConsumptionRecord[] into per-year SpotTaxResult[]"
  - "Haltefrist exemption: lots held >= 366 days excluded from net gain calculation"
  - "Freigrenze cliff: net gain <= 1000 EUR → taxableAmountEur = 0; > 1000 → full amount taxable"
affects:
  - "04-05 and beyond: orchestrator wires calculateSpotTax into TaxCalculationResult"
  - "04-07: tax report generation reads SpotTaxResult array"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function calculator: no side effects, no DB, takes typed array returns typed array"
    - "Group-by-Map pattern for per-year aggregation"
    - "Freigrenze cliff check via Decimal.greaterThan(freigrenze)"
    - "Set<number> for unique sellTransactionId counting (tradeCount)"
    - "TDD RED-GREEN: failing test committed before implementation"

key-files:
  created:
    - packages/backend/src/engine/spot-tax-calculator.ts
    - packages/backend/src/engine/spot-tax-calculator.test.ts
  modified: []

key-decisions:
  - "Freigrenze cliff is netGainEur (taxable gains + taxable losses) only — tax-free (Haltefrist-met) gains/losses excluded from the net calculation entirely"
  - "Haltefrist-met losses are ignored (no tax benefit, no tax liability) — only haltefristMet=false records participate in netting"
  - "ZERO taxable for net loss: greaterThan(freigrenze) guard handles negative net gain correctly"

patterns-established:
  - "Spot tax cliff: if (netGain > freigrenze) → taxableAmount = netGain else taxableAmount = 0"
  - "Tax-free path: haltefristMet=true gains → taxFreeGainEur only, never enters net calculation"

# Metrics
duration: 8min
completed: 2026-03-22
---

# Phase 4 Plan 04: Spot Tax Calculator Summary

**Pure calculateSpotTax function applying §23 EStG Haltefrist exemption and 1000 EUR Freigrenze cliff to FIFO consumption records, with 14 TDD tests confirming all boundary conditions**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-22T21:37:05Z
- **Completed:** 2026-03-22T21:45:00Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Implemented `calculateSpotTax(consumptions: ConsumptionRecord[]): SpotTaxResult[]` pure function
- Confirmed Freigrenze cliff at all three boundaries: 999.99=0, 1000.00=0, 1000.01=full amount
- Confirmed Haltefrist boundary: 365 days taxable, 366 days tax-free
- Verified losses offset gains before Freigrenze check (net gain = taxable gains + taxable losses)
- Tax-free (Haltefrist-met) gains are entirely excluded from net gain — never pollute taxable calculation
- All 430 backend tests pass (407 prior + 14 new + earn-income-engine previously fixed)

## Task Commits

TDD lifecycle:

1. **RED — Failing tests** - `ecd0879` (test)
2. **GREEN — Implementation** - `62c7e02` (feat)

**Plan metadata:** (this docs commit)

_Note: No REFACTOR commit — implementation was clean from first pass._

## Files Created/Modified

- `packages/backend/src/engine/spot-tax-calculator.test.ts` — 14 test cases covering all §23 EStG rules
- `packages/backend/src/engine/spot-tax-calculator.ts` — 100-line pure function, group-by-Map aggregation

## Decisions Made

- **Haltefrist-met losses are ignored entirely**: A tax-free lot that was sold at a loss produces neither a tax benefit nor a tax liability. Only `haltefristMet=false` records enter the net gain/loss calculation. This is consistent with the spirit of §23 EStG — the exemption applies symmetrically.
- **Freigrenze cliff uses `netGain.greaterThan(freigrenze)`**: The `<=` boundary means exactly 1000.00 EUR is still exempt (`greaterThan` returns false). The `0.01` above tips into full taxability — this matches the plan spec and German tax law.
- **tradeCount via `Set<number>`**: Consumptions can share a `sellTransactionId` when one sell consumed multiple lots. We want unique sells, not lot pairings. `Set.size` gives this cheaply.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- `calculateSpotTax` is ready to be wired into the orchestrator (04-05+)
- `SpotTaxResult[]` output feeds directly into `TaxCalculationResult.spotTax`
- Earn income calculator (04-05) follows the same pattern — pure function, per-year aggregation

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
