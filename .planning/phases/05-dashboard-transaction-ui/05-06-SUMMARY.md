---
phase: 05-dashboard-transaction-ui
plan: 06
subsystem: ui
tags: [react, typescript, infinite-scroll, intersection-observer, transactions, filter, sort, badge]

# Dependency graph
requires:
  - phase: 05-02
    provides: GET /api/transactions returning TransactionPageResponse with TransactionListItem[]
  - phase: 05-03
    provides: formatEur, formatNumber, gainLossColor utilities in format.ts

provides:
  - CategoryBadge component with Spot/Futures/Earn/Fee/Transfer/Sonstige color coding
  - TransactionRow component with date, coin, type badge, side, amount, EUR value, fee columns
  - TransactionFilters component with debounced search, year/type dropdowns, date range, reset
  - TransactionList component with infinite scroll, sortable columns, skeleton loading
  - App.tsx transactions tab with collapsible Import & Preise section + TransactionList

affects:
  - 05-07 (transaction detail view — uses selectedId state from TransactionList)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - IntersectionObserver for infinite scroll with sentinel div pattern
    - AbortController per-fetch to cancel stale requests on filter change
    - Debounced search input (300ms) with ref-based timeout cleanup
    - URLSearchParams-based API query building from FilterState
    - Collapsible <details>/<summary> toggle for secondary UI sections

key-files:
  created:
    - packages/frontend/src/components/Transactions/CategoryBadge.tsx
    - packages/frontend/src/components/Transactions/CategoryBadge.css
    - packages/frontend/src/components/Transactions/TransactionRow.tsx
    - packages/frontend/src/components/Transactions/TransactionFilters.tsx
    - packages/frontend/src/components/Transactions/TransactionFilters.css
    - packages/frontend/src/components/Transactions/TransactionList.tsx
    - packages/frontend/src/components/Transactions/TransactionList.css
  modified:
    - packages/frontend/src/App.tsx
    - packages/frontend/src/App.css
    - packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx

key-decisions:
  - "CategoryBadge uses CSS class-based color mapping (not inline style) — enables theming and specificity control"
  - "IntersectionObserver on sentinel div (not scroll event) — performant, no listener overhead"
  - "AbortController cancels in-flight fetch on filter/sort change — prevents stale result race conditions"
  - "availableYears extracted from first page response — avoids separate /api/years endpoint"
  - "Import section wrapped in <details> toggle — preserves import functionality without dominating the tab"

patterns-established:
  - "Infinite scroll: sentinel ref + IntersectionObserver + offset accumulation pattern"
  - "Filter state: flat FilterState object, single onChange callback — no prop drilling"
  - "Badge category: switch-based getCategory() pure function, CATEGORY_CLASS record mapping"

# Metrics
duration: 18min
completed: 2026-03-23
---

# Phase 5 Plan 6: Transaction List UI Summary

**Filterable, sortable transaction list with IntersectionObserver infinite scroll, CategoryBadge color coding, and collapsible import section in the Transaktionen tab**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-03-23T08:07:00Z
- **Completed:** 2026-03-23T08:25:48Z
- **Tasks:** 2/2
- **Files modified:** 10

## Accomplishments

- CategoryBadge component maps all 15 CanonicalType values to 6 display categories with correct brand colors (Spot blue, Futures purple, Earn green, Fee orange, Transfer gray, Sonstige muted)
- TransactionList with IntersectionObserver infinite scroll loading PAGE_SIZE=50 items per fetch, sortable column headers (date/coin/type/amount), loading skeleton, error state, end-of-list marker
- TransactionFilters with 300ms debounced search, year/type (with optgroups) dropdowns, from/to date pickers, reset button — all state wired via URLSearchParams to /api/transactions
- App.tsx transactions tab restructured: import/price section collapsed under `<details>` toggle, TransactionList rendered below

## Task Commits

1. **Task 1: CategoryBadge, TransactionRow, TransactionFilters** - `bd67614` (feat)
2. **Task 2: TransactionList + App.tsx wire-up** - `02fb470` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `packages/frontend/src/components/Transactions/CategoryBadge.tsx` - Pill badge mapping CanonicalType to 6 display categories
- `packages/frontend/src/components/Transactions/CategoryBadge.css` - Badge color variants with 18% opacity backgrounds
- `packages/frontend/src/components/Transactions/TransactionRow.tsx` - Table row with 7 columns, hover/selected state, keyboard nav
- `packages/frontend/src/components/Transactions/TransactionFilters.tsx` - Filter bar: debounced search, year/type selects, date range
- `packages/frontend/src/components/Transactions/TransactionFilters.css` - Glassmorphism-compatible filter bar styles
- `packages/frontend/src/components/Transactions/TransactionList.tsx` - Main list component with infinite scroll, sort, fetch logic
- `packages/frontend/src/components/Transactions/TransactionList.css` - Table, skeleton shimmer, loading spinner, sentinel styles
- `packages/frontend/src/App.tsx` - Added TransactionList import, collapsible import-toggle in transactions tab
- `packages/frontend/src/App.css` - import-toggle details/summary styles
- `packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx` - Fixed pre-existing recharts Tooltip formatter type error

## Decisions Made

- **CategoryBadge CSS classes over inline styles:** Easier to override, consistent with project pattern of class-based color variants.
- **IntersectionObserver not scroll listener:** Zero passive-listener overhead; browser-native, works inside overflow containers.
- **AbortController per fetch:** Ensures stale responses from previous filter state cannot overwrite newer results.
- **availableYears from first page:** Avoids an extra API round-trip; extracted from taxYear fields of initial 50 items. Not comprehensive for >50 years spread, but adequate for typical tax data.
- **`<details>` for import section:** Native HTML, zero JS, animatable with CSS, semantically correct collapsible pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed recharts Tooltip formatter type error in GainLossBarChart**
- **Found during:** Task 1 (TypeScript check after creating first components)
- **Issue:** `formatter={(value: number) => [...]}` — recharts `ValueType` can be `undefined`; strict TS rejects `number` annotation
- **Fix:** Changed to `(value) => [typeof value === 'number' ? formatEur(value, true) : String(value ?? ''), 'Netto']` matching the pattern already used in PnlLineChart and PortfolioDonutChart
- **Files modified:** `packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `bd67614` (Task 1 commit)

**2. [Rule 1 - Bug] Removed stale unused chart imports from Dashboard.tsx**
- **Found during:** Task 2 (TypeScript check after writing TransactionList)
- **Issue:** Dashboard.tsx had 7 unused import statements (ChartCard, GainLossBarChart, etc.) causing TS6133 errors; these were left as "chart slots for plan 05-05" but the compiler caught them
- **Fix:** Imports were removed by the project linter automatically when the file was re-read; no further action needed
- **Files modified:** `packages/frontend/src/components/Dashboard/Dashboard.tsx` (linter auto-fixed)
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `02fb470` (Task 2 commit — file was linter-cleaned before staging)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug, pre-existing from plan 05-04)
**Impact on plan:** Both fixes were necessary for TypeScript compilation to pass. No scope creep — zero new functionality added to unrelated code.

## Issues Encountered

None — both TypeScript errors found were pre-existing from plan 05-04 chart components and were caught during this plan's mandatory `tsc --noEmit` verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TransactionList exposes `selectedId` state (number | null) — plan 07 (TransactionDetail) can receive this as a prop or lift state up through App.tsx
- All 7 must_haves from plan 05-06 are implemented: list display, category badges, filtering, search, sortable columns, infinite scroll, row selection
- The `<details>` import toggle is open by default — consider starting collapsed once the user has imported data (can add logic in 07 or leave as-is)

---
*Phase: 05-dashboard-transaction-ui*
*Completed: 2026-03-23*
