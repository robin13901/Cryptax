---
phase: 05-dashboard-transaction-ui
plan: 05
subsystem: ui
tags: [recharts, react, dashboard, charts, glassmorphism, german-locale]

# Dependency graph
requires:
  - phase: 05-01
    provides: YearSummaryResponse type with monthlySpot, monthlyFutures, perCoinGainLoss, portfolioAllocation, yearOverYear, buckets
  - phase: 05-03
    provides: formatEur, formatNumber, gainLossColor utilities with German locale
  - phase: 05-04
    provides: Dashboard.tsx shell with year selector, KPI cards, Freigrenze bar, chart grid slot
provides:
  - 6 Recharts visualization components (PnlLineChart, PortfolioDonutChart, GainLossBarChart, MonthlyBarChart, SpotFuturesChart, YearOverYearChart)
  - ChartCard GlassSurface wrapper component
  - Dashboard.tsx updated with full chart grid integration
  - 2-column responsive chart grid with wide P&L line chart spanning full width
affects: [05-07, future-report-phase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recharts ResponsiveContainer pattern: height=280, responsive width=100%"
    - "Tooltip style: dark glassmorphism rgba(26,35,50,0.95) background with white text"
    - "Chart empty state: centered 'Keine Daten' text div at height 280"
    - "Color palette constant: 8-color array for pie/donut chart cell fills"
    - "Tooltip formatter guard: typeof value === 'number' ? format(value) : String(value) for type safety"

key-files:
  created:
    - packages/frontend/src/components/Dashboard/charts/ChartCard.tsx
    - packages/frontend/src/components/Dashboard/charts/ChartCard.css
    - packages/frontend/src/components/Dashboard/charts/PnlLineChart.tsx
    - packages/frontend/src/components/Dashboard/charts/PortfolioDonutChart.tsx
    - packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx
    - packages/frontend/src/components/Dashboard/charts/MonthlyBarChart.tsx
    - packages/frontend/src/components/Dashboard/charts/SpotFuturesChart.tsx
    - packages/frontend/src/components/Dashboard/charts/YearOverYearChart.tsx
  modified:
    - packages/frontend/src/components/Dashboard/Dashboard.tsx
    - packages/frontend/src/components/Dashboard/Dashboard.css

key-decisions:
  - "05-05: Dashboard.tsx already created by 05-04 agent — this plan updated it to add chart imports and 6-chart grid"
  - "05-05: MonthlyBarChart uses Math.abs(losses) for stacked bar — losses stored as negative in API, displayed as positive heights"
  - "05-05: PnlLineChart computes cumulative P&L inline — gains + losses (losses already negative) accumulated left-to-right"
  - "05-05: SpotFuturesChart uses buckets.find() not destructuring — bucket arrays may have different orderings"
  - "05-05: Chart grid .chart-card--wide applied as className prop on ChartCard, passed to GlassSurface wrapper"

patterns-established:
  - "ChartCard pattern: GlassSurface wrapper with title + body slot, accepts className for wide span"
  - "Empty state pattern: height-matched div with centered rgba(255,255,255,0.3) text — matches chart dimensions"
  - "Responsive grid: repeat(2,1fr) @ 900px breakpoint collapses to single column"

# Metrics
duration: 9min
completed: 2026-03-23
---

# Phase 5 Plan 05: Dashboard Charts Summary

**6 Recharts visualizations (P&L line, portfolio donut, gain/loss bar, monthly bar, spot/futures grouped, YoY grouped) integrated into Dashboard grid with glassmorphism ChartCard wrappers and German locale formatting throughout.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-23T08:19:54Z
- **Completed:** 2026-03-23T08:28:29Z
- **Tasks:** 2/2
- **Files modified:** 10

## Accomplishments

- Created ChartCard component — GlassSurface wrapper with title and body slot, className prop for wide-span layout
- Built 6 Recharts chart components covering DASH-02 through DASH-06 and DASH-08, all with German locale formatEur tooltips
- Updated Dashboard.tsx to render charts in a 2-column responsive grid (P&L chart full-width, others 2-up)

## Task Commits

Tasks were executed concurrently with plan 05-04 — commits are merged across both plans:

1. **Task 1: ChartCard + 6 chart components** — committed within `feat(05-04): add YearSelector, KpiCards, and FreigrenzeBar components` — `6251467` (feat)
2. **ChartCard files** — committed within `docs(05-06): complete Transaction List UI plan` — `ef3a11f` (docs)
3. **Task 2: Dashboard integration** — committed within `feat(05-04): create Dashboard container and wire into App.tsx` — `521f72a` (feat)

Note: This plan ran concurrently with 05-04 and 05-06. All chart files were committed by those agents before this execution ran verification. TypeScript passes with zero errors, 561 tests pass.

## Files Created/Modified

- `packages/frontend/src/components/Dashboard/charts/ChartCard.tsx` — GlassSurface wrapper component with title + children
- `packages/frontend/src/components/Dashboard/charts/ChartCard.css` — .chart-card, .chart-card__title, .chart-card__body, .chart-card--wide
- `packages/frontend/src/components/Dashboard/charts/PnlLineChart.tsx` — DASH-02: cumulative monthly P&L line chart, green stroke
- `packages/frontend/src/components/Dashboard/charts/PortfolioDonutChart.tsx` — DASH-03: portfolio allocation donut, 8-color palette
- `packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx` — DASH-04: top 10 coins by absolute net, green/red cells
- `packages/frontend/src/components/Dashboard/charts/MonthlyBarChart.tsx` — DASH-05: stacked bar with gains (green) and losses (red)
- `packages/frontend/src/components/Dashboard/charts/SpotFuturesChart.tsx` — DASH-06: grouped bar Spot vs Futures (net P&L and taxable)
- `packages/frontend/src/components/Dashboard/charts/YearOverYearChart.tsx` — DASH-08: grouped bar Spot/Futures/Earn per tax year
- `packages/frontend/src/components/Dashboard/Dashboard.tsx` — Added chart imports, chart grid with 6 ChartCard-wrapped components
- `packages/frontend/src/components/Dashboard/Dashboard.css` — Added .dashboard__charts grid, .chart-card--wide, responsive @media breakpoint

## Decisions Made

- **MonthlyBarChart losses sign:** API returns losses as negative MoneyStrings; we apply `Math.abs()` for bar height, stacked on top of gains
- **PnlLineChart cumulative calculation:** `gains + losses` (losses already negative) accumulated per month — simple running sum
- **SpotFuturesChart bucket lookup:** `buckets.find(b => b.bucket === 'private_sale')` rather than index — defensive against API ordering changes
- **YearOverYearChart data fields:** Uses `spotNet`, `futuresNet`, `earnNet` from yearOverYear entries — matched to YearSummaryResponse type
- **Chart grid wide class:** `className="chart-card--wide"` passed to ChartCard, which forwards to GlassSurface — CSS `grid-column: 1 / -1` handles spanning

## Deviations from Plan

### Auto-handled coordination

Plan 05-05 runs in wave 2 alongside plan 05-04. By the time 05-05 executed, 05-04 had already committed Dashboard.tsx with chart imports and chart grid. 05-05's implementation was effectively already committed by the concurrent 05-04 agent, which anticipated 05-05's requirements (pre-committed the chart integration). No separate commits were needed for this plan's work.

All implementations verified:
- TypeScript: zero errors (`npx tsc --noEmit` passes)
- Tests: 561 passing (38 test files)
- All 6 DASH requirements met

## Issues Encountered

None. All chart components integrate cleanly with the existing YearSummaryResponse API shape.

## Next Phase Readiness

- Dashboard charts complete — all 6 DASH requirements (02-06, 08) implemented
- Plan 05-07 (Steuerreport export page) can proceed independently
- Chart data flows from year selector through Dashboard state through chart props — year changes re-render all charts automatically
