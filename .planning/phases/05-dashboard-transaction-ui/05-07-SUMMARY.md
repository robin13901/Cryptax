---
phase: 05
plan: 07
subsystem: frontend-transaction-detail
tags: [react, framer-motion, testing-library, fifo, tax-impact, slide-panel]
depends_on: ["05-04", "05-05", "05-06"]
provides: ["TransactionDetail slide-in panel", "component test suite for all UI components"]
affects: []
tech-stack:
  added: []
  patterns:
    - "AnimatePresence wrapping optional panel in parent, panel returns null when id=null"
    - "vi.spyOn(global, 'fetch') for reliable mock/restore in jsdom tests"
    - "Global @testing-library/react cleanup in setup.ts via afterEach"
    - "getAllByText for disambiguation when same text appears multiple places in DOM"
key-files:
  created:
    - packages/frontend/src/components/Transactions/TransactionDetail.tsx
    - packages/frontend/src/components/Transactions/TransactionDetail.css
    - packages/frontend/src/components/Dashboard/Dashboard.test.tsx
    - packages/frontend/src/components/Transactions/CategoryBadge.test.tsx
    - packages/frontend/src/components/Transactions/TransactionList.test.tsx
    - packages/frontend/src/components/Transactions/TransactionDetail.test.tsx
  modified:
    - packages/frontend/src/components/Transactions/TransactionList.tsx
    - packages/frontend/src/test/setup.ts
decisions:
  - "TransactionDetail returns null when transactionId=null — AnimatePresence exit animation handled by parent (TransactionList)"
  - "vi.spyOn(global, 'fetch') preferred over vi.stubGlobal for reliable restoreAllMocks() cleanup"
  - "Global cleanup() in setup.ts afterEach instead of per-test — eliminates DOM isolation boilerplate in every test file"
  - "TransactionDetail panel guard: if (transactionId === null) return null placed AFTER state variable declarations — avoids rules-of-hooks violations"
metrics:
  duration: "16 min"
  completed: "2026-03-23"
  tests_added: 59
  tests_total: 591
---

# Phase 5 Plan 7: Transaction Detail Panel + Component Tests Summary

**One-liner:** TransactionDetail glassmorphism slide-in panel with FIFO lot table and tax impact, plus 59 new component tests covering Dashboard, TransactionList, TransactionDetail, and CategoryBadge.

## What Was Built

### Task 1: TransactionDetail slide-in panel

**TransactionDetail.tsx** — Motion/react slide-in panel, 480px wide, entering from right.

Props: `transactionId: number | null`, `onClose`, `onNavigate`, `hasPrev`, `hasNext`.

When `transactionId` is null the component returns null (the `AnimatePresence` wrapper in `TransactionList` handles the exit animation). When an ID is set, it fetches `/api/transactions/:id` and renders 5 sections:

1. Header: close button, prev/next navigation arrows (disabled when at edges), summary line
2. Transaction details: all `Transaction` fields in `<dl>` definition list with `formatEur`/`formatNumber`
3. FIFO lot consumption table (visible only when `lotConsumptions.length > 0`): Kaufdatum, Menge, Einstand, Erlös, G/V (color-coded green/red), Tage, Frei (with "Ja" badge when haltefristMet)
4. Futures position section (when `futuresPosition !== null`): realizedPnlEur, feeEur
5. Earn income section (when `earnIncome !== null`): amount, eurValueAtReceipt
6. Tax impact: BucketBadge (private_sale/futures_pnl/staking_earn/null), total G/V, Steuerfrei badge, reason text

**TransactionDetail.css** — Glassmorphism panel: `rgba(18,24,38,0.85)` background with `backdrop-filter: blur(24px)`, right-side border and deep box-shadow. Monospace font for numeric cells. Color-coded bucket badges (blue/purple/amber).

**TransactionList.tsx updates:**
- Added `AnimatePresence` import from `motion/react`
- Added `handleNavigate(direction)` function — looks up `selectedIdx` in `items`, steps prev/next
- Added `selectedIdx`, `hasPrev`, `hasNext` computed values
- Renders `<TransactionDetail>` inside `<AnimatePresence>` at bottom of container

### Task 2: Component tests (59 tests)

**CategoryBadge.test.tsx** (18 tests): All 15 canonical types mapped to correct badge category and CSS class.

**Dashboard.test.tsx** (9 tests): Empty state, KPI cards with 4 labels, trade count display, YearSelector combobox options, FreigrenzeBar conditional rendering, fetch URL format, year change via `selectOptions`.

**TransactionList.test.tsx** (13 tests): Row rendering, Spot/Earn/Futures badge rendering, empty state, error states (network fail and HTTP 500), table headers, side labels (Kauf/Verkauf), row click opens detail panel, end-of-list marker.

**TransactionDetail.test.tsx** (19 tests): Null guard (returns nothing), loading spinner, transaction data display, fetch URL, FIFO lot table presence and structure, Steuerfrei badge, tax impact section, futures/earn section rendering, close button, overlay click, prev/next navigation buttons (and disabled state), `aria-modal` role, re-fetch on id change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TransactionDetail rendered panel even when transactionId=null**

- **Found during:** Task 2 (test "is not visible when transactionId is null" failed)
- **Issue:** Component always rendered overlay and panel — even with null id — because the early-return guard was missing
- **Fix:** Added `if (transactionId === null) return null;` guard after state declarations
- **Files modified:** `TransactionDetail.tsx`
- **Commit:** Included in e2e970d (plan fix inline)

**2. [Rule 1 - Bug] DOM not cleaned up between tests (multiple-element ambiguity)**

- **Found during:** Task 2 (CategoryBadge and Dashboard tests accumulated DOM from prior test renders)
- **Issue:** `@testing-library/react` cleanup was not wired into the global setup; each test left its DOM in document
- **Fix:** Added `import { cleanup } from '@testing-library/react'` + `afterEach(() => cleanup())` to `packages/frontend/src/test/setup.ts`
- **Files modified:** `setup.ts`
- **Commit:** 9dda409

**3. [Rule 1 - Bug] vi.stubGlobal('fetch') not restored by vi.restoreAllMocks()**

- **Found during:** Task 2 (Dashboard test "makes fetch call" got `TypeError: fetch(...).then is not a function` — fetch returned undefined)
- **Issue:** `vi.stubGlobal` creates a stub that requires `vi.unstubAllGlobals()` to restore; `vi.restoreAllMocks()` only restores `vi.spyOn` spies
- **Fix:** Switched all fetch mocking to `vi.spyOn(global, 'fetch')` — properly restored by `vi.restoreAllMocks()`
- **Files modified:** `Dashboard.test.tsx`, `TransactionList.test.tsx`, `TransactionDetail.test.tsx`
- **Commit:** 9dda409

**4. [Rule 2 - Missing Critical] Test assertions needed disambiguation for shared text values**

- **Found during:** Task 2 ("shows transaction data" test — `getByText('sell')` matched both canonicalType and side fields; "FIFO lot table" test — `getByText('Menge')` matched both `<dt>` and `<th>`)
- **Fix:** Changed to `getAllByText('sell').length >= 1` and `getByRole('table', { name: 'FIFO Lots' })` for table-specific assertions
- **Files modified:** `TransactionDetail.test.tsx`
- **Commit:** 9dda409

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `return null` when `transactionId=null` | AnimatePresence in TransactionList handles exit; panel itself doesn't need to animate out |
| `vi.spyOn(global, 'fetch')` over `vi.stubGlobal` | `restoreAllMocks()` works correctly; no need for `unstubAllGlobals()` |
| Global cleanup in setup.ts | Eliminates per-file cleanup boilerplate; consistent with `@testing-library/react` docs recommendation |
| `getAllByText` for ambiguous selectors | Same text appears in multiple structural elements (side + canonicalType both = 'sell', 'Menge' in `<dt>` and `<th>`) |

## Commits

| Hash | Message |
|------|---------|
| e2e970d | feat(05-07): add TransactionDetail slide-in panel with FIFO lots and tax impact |
| 9dda409 | test(05-07): add component tests for Dashboard, TransactionList, TransactionDetail, CategoryBadge |

## Test Results

```
Test Files: 40 passed
Tests:      591 passed (0 failed)
```

59 new frontend component tests added. All 591 tests pass.

## Next Phase Readiness

Phase 5 is now complete — all 7 plans executed. The full Dashboard + Transaction UI is built:
- Summary API (05-01)
- Transactions API (05-02)
- Format utilities (05-03)
- Dashboard shell + KPIs (05-04)
- Dashboard charts (05-05)
- Transaction list with infinite scroll (05-06)
- Transaction detail panel + component tests (05-07)

Phase 6 (Steuerreport Export) can proceed.
