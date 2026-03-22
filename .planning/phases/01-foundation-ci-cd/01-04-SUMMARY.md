---
phase: 01-foundation-ci-cd
plan: 04
subsystem: shared-types
tags: [decimal.js, typescript, domain-types, monetary-arithmetic, tax-constants, fifo]

# Dependency graph
requires:
  - phase: 01-foundation-ci-cd/01-01
    provides: npm workspaces monorepo with @cryptax/shared scaffold
provides:
  - "@cryptax/shared domain interfaces: Transaction, NormalizedTransaction, TaxSummary, FifoLot, LotConsumption, FuturesPosition, EarnIncome, DashboardKpi"
  - "Decimal.js utilities: toDecimal, fromDecimal, ZERO, addMoney, subtractMoney, multiplyMoney, compareMoney, isZero, isNegative"
  - "TAX_CONSTANTS: German tax law values (HALTEFRIST_DAYS, SPOT_FREIGRENZE_EUR, EARN_FREIGRENZE_EUR, ABGELTUNGSSTEUER_RATE, EXCHANGES)"
  - "String-typed monetary fields enforced at type level across all domain interfaces"
affects:
  - 01-foundation-ci-cd/01-03 (database schema uses these types)
  - 01-foundation-ci-cd/01-06 (backend imports from @cryptax/shared)
  - 01-foundation-ci-cd/01-07 (frontend imports from @cryptax/shared)
  - All phases that do monetary arithmetic or reference domain models

# Tech tracking
tech-stack:
  added: [decimal.js@^10.6.0]
  patterns:
    - "All monetary fields typed as MoneyString (= string) — never number — enforced at TypeScript level"
    - "Decimal.js configured globally: precision 36, ROUND_HALF_UP"
    - "TEXT/string round-trip: DB TEXT → toDecimal() → arithmetic → fromDecimal() → DB TEXT"
    - "TAX_CONSTANTS as const object with string monetary values for Decimal compatibility"

key-files:
  created:
    - packages/shared/src/types/transaction.ts
    - packages/shared/src/types/tax.ts
    - packages/shared/src/types/index.ts
    - packages/shared/src/decimal/money.ts
    - packages/shared/src/decimal/index.ts
    - packages/shared/src/constants/index.ts
  modified:
    - packages/shared/src/index.ts
    - packages/shared/package.json

key-decisions:
  - "MoneyString = string alias used for all monetary fields to make intent explicit in interfaces"
  - "Decimal.js configured globally at module load time in money.ts (not per-call) to avoid repeated config"
  - "toDecimal handles null/undefined/empty string by returning ZERO (safe default for DB reads)"
  - "fromDecimal uses .toFixed() for full precision without exponential notation"
  - "TAX_CONSTANTS uses 'as const' for type-narrowing on EXCHANGES tuple"
  - "SPOT_FREIGRENZE_EUR set to 1000 (2024+ tax year value, increased from 600)"

patterns-established:
  - "Pattern: MoneyString fields — all domain interfaces use string for monetary values, never number"
  - "Pattern: Decimal arithmetic — always convert with toDecimal() before math, convert back with fromDecimal()"
  - "Pattern: TAX_CONSTANTS — single source of truth for German tax law thresholds"

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 1 Plan 04: Shared Package Types and Decimal.js Utilities Summary

**Decimal.js (precision 36, ROUND_HALF_UP) with full domain type interfaces — Transaction, FifoLot, TaxSummary, EarnIncome — all monetary fields typed as `string`, plus TAX_CONSTANTS with German tax law values**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T16:17:40Z
- **Completed:** 2026-03-21T16:24:23Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Domain type interfaces with string-typed monetary fields establish the TEXT storage contract at the TypeScript type level
- Decimal.js utilities (toDecimal/fromDecimal + arithmetic helpers) provide the only sanctioned monetary arithmetic path
- TAX_CONSTANTS encodes German tax law: Haltefrist 365 days, §23 Freigrenze 1000 EUR, §22 Freigrenze 256 EUR, Abgeltungsteuer 26.375%
- All exports verified at runtime via compiled dist output

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Decimal.js and create shared type definitions** - `03d5cc2` (feat(01-02)) — already committed in prior session
2. **Task 2: Create Decimal.js utilities and constants** - `e827955` (feat(01-04))

**Plan metadata:** `[see below]` (docs: complete plan)

_Note: Task 1 types were committed in a prior session under commit 03d5cc2 (feat(01-02)). Task 2 is the new work in this execution._

## Files Created/Modified
- `packages/shared/src/types/transaction.ts` - Transaction, TransactionListItem, ImportSummary, ImportError with MoneyString fields
- `packages/shared/src/types/tax.ts` - FifoLot, LotConsumption, FuturesPosition, EarnIncome, TaxSummary, DashboardKpi, TaxBucket
- `packages/shared/src/types/index.ts` - Barrel re-export of all type interfaces
- `packages/shared/src/decimal/money.ts` - Decimal.js config (precision 36, ROUND_HALF_UP) + toDecimal, fromDecimal, ZERO, arithmetic helpers
- `packages/shared/src/decimal/index.ts` - Barrel re-export of decimal utilities
- `packages/shared/src/constants/index.ts` - TAX_CONSTANTS with HALTEFRIST_DAYS, SPOT_FREIGRENZE_EUR, EARN_FREIGRENZE_EUR, ABGELTUNGSSTEUER_RATE, EXCHANGES
- `packages/shared/src/index.ts` - Top-level barrel re-exporting all types, decimal, constants
- `packages/shared/package.json` - Added decimal.js@^10.6.0 dependency

## Decisions Made
- `MoneyString = string` alias used for all monetary fields to make intent explicit in interfaces
- Decimal.js configured globally at module load time in money.ts (not per-call) for efficiency
- `toDecimal` handles null/undefined/empty string gracefully by returning ZERO — safe for DB reads
- `fromDecimal` uses `.toFixed()` for full precision without exponential notation
- `TAX_CONSTANTS.SPOT_FREIGRENZE_EUR` set to `'1000'` (2024+ value, increased from 600 EUR)
- `EXCHANGES` typed as `['bitget'] as const` with `SupportedExchange` type alias for type narrowing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Applied Biome import sorting to barrel files**
- **Found during:** Task 2 (Biome check)
- **Issue:** Barrel export order in index.ts, decimal/index.ts, types/index.ts violated Biome's organizeImports rule
- **Fix:** Ran `biome check --write` to auto-sort exports alphabetically
- **Files modified:** packages/shared/src/index.ts, packages/shared/src/decimal/index.ts, packages/shared/src/types/index.ts
- **Verification:** `npx biome check packages/shared/src/` reports 0 errors after fix
- **Committed in:** e827955 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical / style)
**Impact on plan:** Minor formatting fix, no functional change.

## Issues Encountered
- Task 1 type files were already committed in a prior session (commit 03d5cc2) as part of plan 01-02 execution. Files matched the plan spec exactly. No rework needed, Task 2 proceeded normally.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `@cryptax/shared` exports all required types, decimal utilities, and constants
- Backend (01-03 database schema) can import Transaction, FifoLot, TaxSummary etc.
- Frontend can import the same interfaces for type-safe API contracts
- Decimal.js arithmetic pattern established — all future monetary code must use toDecimal/fromDecimal
- No blockers for remaining Phase 1 plans

---
*Phase: 01-foundation-ci-cd*
*Completed: 2026-03-21*
