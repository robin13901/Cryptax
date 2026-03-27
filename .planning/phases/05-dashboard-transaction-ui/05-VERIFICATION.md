---
phase: 05-dashboard-transaction-ui
verified: 2026-03-23T08:57:23Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: Filtering by type + coin + date range reduces the transaction list correctly
    status: failed
    reason: Three parameter name mismatches between frontend and backend
    artifacts:
      - path: packages/frontend/src/components/Transactions/TransactionList.tsx
        issue: buildParams sends canonicalType (line 52), dateFrom/dateTo (lines 53-54) -- param names differ from what backend expects
      - path: packages/backend/src/routes/transactions.ts
        issue: Destructures type, from, to from query (line 68) -- these never match the frontend param names
      - path: packages/frontend/src/components/Transactions/TransactionFilters.tsx
        issue: No coin input field rendered. FilterState.coin always empty. Never sent to backend.
    missing:
      - Change p.set to use key type instead of canonicalType in TransactionList.tsx line 52
      - Change p.set to use keys from and to instead of dateFrom and dateTo in TransactionList.tsx
      - Add coin text input to TransactionFilters.tsx and wire p.set coin param in buildParams
---

# Phase 05: Dashboard + Transaction UI -- Verification Report

**Phase Goal:** The Dashboard and Transaktionen tabs show live data from the database -- KPI cards with real calculated numbers, all six Recharts visualizations rendering correctly, a year selector that updates all charts, and a transaction list that is filterable, searchable, and sortable.
**Verified:** 2026-03-23T08:57:23Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Year selector updates all 4 KPI cards with real calculated values | VERIFIED | Dashboard.tsx fetches /api/summary/year on year change. KpiCards.tsx renders totalNetEur, totalTradeCount, totalTaxableEur, totalEstimatedTaxEur via formatEur. No placeholder text when data present. |
| 2 | All six charts render with real data, each responding to year selector | VERIFIED | All 6 chart components receive data prop from Dashboard state. All parse real numeric fields. Keine Daten shown only when arrays are empty. |
| 3 | Transaktionen tab: filtering by type + coin + date range reduces list correctly | FAILED | CategoryBadge maps all 15 types correctly. Search and year filter work. Type filter sends canonicalType param but backend reads type. Date range sends dateFrom/dateTo but backend reads from/to. Coin filter has no UI input. |
| 4 | Clicking a transaction opens detail view with FIFO lots and tax impact | VERIFIED | TransactionDetail.tsx fetches /api/transactions/:id. Renders FIFO lot table, futuresPosition and earnIncome sections, taxImpact with BucketBadge. |
| 5 | Freigrenze indicator shows correct proximity with color-coded warning states | VERIFIED | FreigrenzeBar.tsx: barColor() returns green for pct<70, amber at >=70, red at >=90. ARIA role=progressbar present. |

**Score:** 4/5 truths verified

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|----------|
| packages/shared/src/types/summary.ts | VERIFIED | 46 lines, all YearSummaryResponse fields present |
| packages/backend/src/routes/summary.ts | VERIFIED | 257 lines, real DB queries for all 9 data fields |
| packages/backend/src/routes/transactions.ts | VERIFIED | 336 lines, pagination, filters, sort, FIFO lot join, taxImpact |
| packages/backend/src/index.ts | VERIFIED | Both registerSummaryRoutes and registerTransactionRoutes called |
| packages/shared/src/index.ts | VERIFIED | YearSummaryResponse, TransactionPageResponse, TransactionDetailResponse, LotConsumptionDetail all exported |
| packages/frontend/src/components/Dashboard/Dashboard.tsx | VERIFIED | 136 lines, fetches API, renders YearSelector, KpiCards, FreigrenzeBar, 6 ChartCards |
| packages/frontend/src/components/Dashboard/KpiCards.tsx | VERIFIED | 59 lines, renders all 4 KPIs from data |
| packages/frontend/src/components/Dashboard/YearSelector.tsx | VERIFIED | 34 lines, onChange wired to Dashboard.setSelectedYear |
| packages/frontend/src/components/Dashboard/FreigrenzeBar.tsx | VERIFIED | 91 lines, barColor() green/amber/red thresholds, ARIA progressbar |
| packages/frontend/src/components/Dashboard/charts/PnlLineChart.tsx | VERIFIED | 81 lines, Recharts LineChart, cumulative sum from monthlySpot |
| packages/frontend/src/components/Dashboard/charts/PortfolioDonutChart.tsx | VERIFIED | 69 lines, Recharts PieChart with innerRadius, portfolioAllocation data |
| packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx | VERIFIED | 79 lines, top-10 sort, green/red Cell, perCoinGainLoss data |
| packages/frontend/src/components/Dashboard/charts/MonthlyBarChart.tsx | VERIFIED | 72 lines, stacked gains+losses bars, monthlySpot data |
| packages/frontend/src/components/Dashboard/charts/SpotFuturesChart.tsx | VERIFIED | 86 lines, 2 bar groups Netto P&L and Steuerpflichtig |
| packages/frontend/src/components/Dashboard/charts/YearOverYearChart.tsx | VERIFIED | 78 lines, 3 bars Spot/Futures/Earn, yearOverYear data |
| packages/frontend/src/components/Transactions/TransactionList.tsx | PARTIAL | 278 lines. IntersectionObserver and AbortController present. Type/coin/date-range filter params mismatched with backend. |
| packages/frontend/src/components/Transactions/TransactionFilters.tsx | PARTIAL | 187 lines. Type/year/date/search UI present. No coin input. Type param name wrong. |
| packages/frontend/src/components/Transactions/CategoryBadge.tsx | VERIFIED | 57 lines, all 15 CanonicalType values mapped to 6 categories |
| packages/frontend/src/components/Transactions/TransactionRow.tsx | VERIFIED | 57 lines, 7 columns, CategoryBadge wired, formatEur/formatNumber used |
| packages/frontend/src/components/Transactions/TransactionDetail.tsx | VERIFIED | 339 lines, FIFO lot table, futures/earn sections, taxImpact with BucketBadge |
| packages/frontend/src/App.tsx | VERIFIED | Dashboard and TransactionList both rendered in their tab slots |

---

## Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| Dashboard.tsx | GET /api/summary/:year | fetch in useEffect | WIRED |
| All 6 chart components | Dashboard data state | data prop | WIRED |
| YearSelector.tsx | Dashboard.setSelectedYear | onChange | WIRED |
| summary.ts route | taxSummaries, lotConsumptions, fifoLots | Drizzle queries | WIRED |
| registerSummaryRoutes | backend/index.ts | import + call line 21 | WIRED |
| registerTransactionRoutes | backend/index.ts | import + call line 22 | WIRED |
| TransactionList.tsx | GET /api/transactions | fetch with URLSearchParams | PARTIAL -- year/search/sort work; type/coin/date-range params broken |
| TransactionDetail.tsx | GET /api/transactions/:id | fetch on transactionId change | WIRED |
| transactions.ts GET /:id | lotConsumptions + fifoLots | Drizzle innerJoin | WIRED |
| transactions.ts GET /:id | computeTaxImpact() | function call | WIRED |

---

## Requirements Coverage

| Success Criterion | Status | Notes |
|-------------------|--------|-------|
| 1. Year selector updates all 4 KPI cards | SATISFIED | All 4 KPIs render from API data |
| 2. All six charts render with real data | SATISFIED | All 6 DASH requirements implemented |
| 3. Filtering by type + coin + date range works | BLOCKED | 3 param name mismatches + absent coin filter UI |
| 4. Detail view with FIFO lots + tax impact | SATISFIED | Full detail panel implemented and wired |
| 5. Freigrenze indicator with color-coded states | SATISFIED | green/amber/red thresholds at 70%/90% |

---

## Anti-Patterns Found

| File | Issue | Severity |
|------|-------|----------|
| packages/frontend/src/App.tsx lines 122-129 | Steuerreport tab renders placeholder text | Info -- Phase 06 scope |

No blocker anti-patterns found in Phase 05 components.

---

## Human Verification Required

### 1. Year selector auto-select behavior
**Test:** Open Dashboard after engine has run with multiple years of data.
**Expected:** Most recent tax year auto-selected. All KPIs and charts show that year.
**Why human:** Requires live DB with multi-year engine data.

### 2. Freigrenze amber threshold
**Test:** View Dashboard with spot gains between 700-899 EUR.
**Expected:** Spot Freigrenze bar shows amber (#f59e0b).
**Why human:** Requires specific data values near the 70% threshold.

### 3. Charts respond to year change
**Test:** Select a different year in dropdown. Observe all 6 charts update.
**Expected:** All charts re-render for newly selected year.
**Why human:** Requires live API with multi-year data.

### 4. Infinite scroll triggers
**Test:** Import more than 50 transactions. Scroll to bottom of Transaktionen tab.
**Expected:** Next page loads automatically.
**Why human:** Requires real browser viewport with IntersectionObserver.

---

## Gaps Summary

One gap blocks Success Criterion 3. The root cause is three query parameter name mismatches between TransactionList.tsx (frontend URL builder) and transactions.ts (backend reader). These are silent failures -- the backend ignores unrecognized params and returns unfiltered results with no error indication.

**Gap 1 -- Type filter broken:**
TransactionList.tsx line 52 sends the param as canonicalType. Backend line 68 destructures the param as type.
Fix: change p.set to use key type instead of canonicalType.

**Gap 2 -- Date range filter broken:**
TransactionList.tsx lines 53-54 send params as dateFrom and dateTo. Backend line 68 reads from and to (used in line 79 between clause).
Fix: send from and to instead of dateFrom and dateTo.

**Gap 3 -- Coin filter absent from UI:**
FilterState.coin exists in types but no input element renders it. buildParams never sends the coin param. Backend line 78 already handles coin param correctly.
Fix: add coin text input to TransactionFilters.tsx and wire coin param in buildParams.

All three fixes are isolated to 2 files and require no architectural changes. All other Phase 05 goals are fully achieved.

---

_Verified: 2026-03-23T08:57:23Z_
_Verifier: Claude (gsd-verifier)_
