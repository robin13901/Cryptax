---
phase: 05-dashboard-transaction-ui
plan: 03
subsystem: ui
tags: [intl, formatting, german-locale, currency, recharts, infinite-scroll, vitest, jsdom]

# Dependency graph
requires:
  - phase: 05-01
    provides: Vite + React + Vitest frontend scaffold with jsdom environment
  - phase: 05-02
    provides: Summary API types (MoneyString, TaxSummary) consumed by format utilities
provides:
  - formatEur: MoneyString/number -> German locale currency string (de-DE, EUR)
  - formatNumber: German locale number formatting with configurable decimals
  - formatPercent: ratio -> German locale percentage string
  - gainLossColor: CSS variable selector for positive/negative/neutral monetary values
  - ResizeObserver mock in test setup (required by Recharts)
  - IntersectionObserver mock in test setup (required by infinite scroll)
affects:
  - 05-04-PLAN.md (TaxSummaryCard needs formatEur, gainLossColor)
  - 05-05-PLAN.md (charts use formatEur for axis labels)
  - 05-06-PLAN.md (TransactionTable uses formatEur, formatNumber, gainLossColor)
  - 05-07-PLAN.md (any chart/list component needs ResizeObserver mock)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Intl.NumberFormat de-DE locale for all monetary display
    - CSS custom property (var(--crypto-green/red)) for gain/loss coloring
    - Browser API global mocks in vitest setup file

key-files:
  created:
    - packages/frontend/src/utils/format.ts
    - packages/frontend/src/utils/format.test.ts
  modified:
    - packages/frontend/src/test/setup.ts

key-decisions:
  - "de-DE Intl.NumberFormat: jsdom renders EUR as '€' symbol not 'EUR' — test assertions use /EUR|€/ regex"
  - "gainLossColor returns CSS variable strings, not hex — allows theming via CSS custom properties"
  - "formatEur showSign defaults to false; pass true for P&L displays"
  - "ResizeObserver/IntersectionObserver mocks added to shared setup.ts, not individual test files"

patterns-established:
  - "German locale formatting: always use formatEur/formatNumber/formatPercent, never raw Intl.NumberFormat inline"
  - "Gain/loss color: use gainLossColor() utility, not conditional className logic in components"
  - "Browser API mocks: add to packages/frontend/src/test/setup.ts for project-wide availability"

# Metrics
duration: 5min
completed: 2026-03-23
---

# Phase 05 Plan 03: Format Utilities + Test Setup Summary

**German locale format utilities (formatEur, formatNumber, formatPercent, gainLossColor) with ResizeObserver and IntersectionObserver mocks for Recharts and infinite scroll testing**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-23T08:09:17Z
- **Completed:** 2026-03-23T08:13:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `formatEur` converts MoneyString/number to German locale currency ("1.234,56 €") with optional sign display for P&L coloring
- `formatNumber`/`formatPercent` provide consistent de-DE locale formatting across all display contexts
- `gainLossColor` returns CSS custom property variables for theming positive/negative/neutral values
- Test setup extended with `ResizeObserver` and `IntersectionObserver` mocks; all 487 existing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create German locale format utilities with tests** - `5a4725b` (feat)
2. **Task 2: Extend test setup with ResizeObserver and IntersectionObserver mocks** - `e3c03fa` (chore)

## Files Created/Modified

- `packages/frontend/src/utils/format.ts` - Four format/color utilities using Intl.NumberFormat de-DE
- `packages/frontend/src/utils/format.test.ts` - 20 unit tests covering all functions and edge cases
- `packages/frontend/src/test/setup.ts` - Added ResizeObserver and IntersectionObserver global mocks

## Decisions Made

- **jsdom EUR rendering**: jsdom renders de-DE currency as `€` symbol, not `EUR` text. Test assertions use `/EUR|€/` regex to remain portable across environments.
- **gainLossColor uses CSS variables**: Returns `var(--crypto-green)` / `var(--crypto-red)` strings instead of hex colors, enabling CSS theme control without JS changes.
- **showSign defaults false**: `formatEur` shows no explicit sign by default; callers pass `true` for P&L contexts where sign direction is meaningful.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertions for jsdom EUR symbol rendering**

- **Found during:** Task 1 verification (running format tests)
- **Issue:** Plan specified `expect(result).toContain('EUR')` but jsdom's Intl.NumberFormat renders de-DE currency as `€` symbol, not `EUR` text. 3 tests failed.
- **Fix:** Changed assertions to `expect(result).toMatch(/EUR|€/)` — correctly matches both jsdom (`€`) and Node.js full-ICU (`EUR`) environments.
- **Files modified:** `packages/frontend/src/utils/format.test.ts`
- **Verification:** All 20 format tests pass; assertion remains meaningful in both environments.
- **Committed in:** `5a4725b` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for test correctness in jsdom. No scope creep.

## Issues Encountered

None beyond the jsdom EUR rendering deviation (documented above).

## Next Phase Readiness

- `formatEur`, `formatNumber`, `formatPercent`, `gainLossColor` ready for import by all Phase 05 components
- `ResizeObserver` mock enables Recharts `<ResponsiveContainer>` to render without error in tests
- `IntersectionObserver` mock enables infinite scroll hooks to register callbacks without error in tests
- All 487 tests pass — no regressions introduced

---
*Phase: 05-dashboard-transaction-ui*
*Completed: 2026-03-23*
