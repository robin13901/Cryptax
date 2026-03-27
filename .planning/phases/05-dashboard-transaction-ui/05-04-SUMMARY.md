---
phase: 05
plan: 04
subsystem: frontend-dashboard
tags: [react, typescript, dashboard, kpi, freigrenze, year-selector, recharts]

dependency-graph:
  requires: ["05-01", "05-03"]
  provides: ["Dashboard component", "KpiCards", "YearSelector", "FreigrenzeBar", "Dashboard wired into App.tsx"]
  affects: ["05-05"]

tech-stack:
  added: []
  patterns:
    - "Controlled year selector with auto-select most-recent on mount"
    - "Cancellable fetch pattern with cancelled flag in useEffect cleanup"
    - "gainLossColor CSS variable theming for P&L values"
    - "Dual progress bar with color thresholds (green/amber/red)"
    - "ARIA progressbar attributes on FreigrenzeBar"

key-files:
  created:
    - packages/frontend/src/components/Dashboard/Dashboard.tsx
    - packages/frontend/src/components/Dashboard/Dashboard.css
    - packages/frontend/src/components/Dashboard/KpiCards.tsx
    - packages/frontend/src/components/Dashboard/YearSelector.tsx
    - packages/frontend/src/components/Dashboard/FreigrenzeBar.tsx
    - packages/frontend/src/components/Dashboard/FreigrenzeBar.css
  modified:
    - packages/frontend/src/App.tsx
    - packages/frontend/src/components/Dashboard/charts/GainLossBarChart.tsx
    - packages/frontend/src/components/Dashboard/charts/MonthlyBarChart.tsx
    - packages/frontend/src/components/Dashboard/charts/PnlLineChart.tsx
    - packages/frontend/src/components/Dashboard/charts/PortfolioDonutChart.tsx
    - packages/frontend/src/components/Dashboard/charts/SpotFuturesChart.tsx
    - packages/frontend/src/components/Dashboard/charts/YearOverYearChart.tsx

decisions:
  - "Dashboard.tsx uses dashboard__header / dashboard__freigrenze BEM classes matching pre-existing Dashboard.css"
  - "YearSelector renders disabled state with 'Keine Daten' when years array is empty"
  - "FreigrenzeBar thresholds: pct < 70 = green, 70-89 = amber (#f59e0b), >= 90 = red"
  - "Dashboard auto-selects most recent year only when selectedYear equals current calendar year (avoids infinite loop)"
  - "Chart grid rendered immediately with existing chart components from prior plan; no separate placeholder needed"

metrics:
  tasks-completed: 2
  tasks-total: 2
  duration: "7 min"
  completed: "2026-03-23"
---

# Phase 05 Plan 04: Dashboard Shell Summary

**One-liner:** Real data-driven Dashboard with year selector, 4 KPI cards using German locale + gainLossColor, and dual Freigrenze progress bar wired to `/api/summary/:year`.

## What Was Built

Replaced the placeholder dashboard in App.tsx with a full `<Dashboard />` component that:

1. Fetches `/api/summary/${selectedYear}` on mount and on year change
2. Shows a year dropdown (YearSelector) defaulting to most recent year from API
3. Renders 4 KPI cards (Gesamtgewinn, Trades, Steuerpflichtig, Steuer est.) with German locale formatting and gain/loss color coding
4. Shows a dual Freigrenze progress bar for Spot §23 (1.000 EUR) and Earn §22 (256 EUR) with green/amber/red thresholds
5. Shows empty state when engineHasRun=false
6. Renders the full chart grid (recharts charts from prior plan) when engine has run

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| BEM class names in Dashboard.tsx | Dashboard.css already used dashboard__header / dashboard__freigrenze — kept consistent |
| FreigrenzeBar amber at 70% | Standard warning threshold; matches common UI conventions |
| Auto-select guards `selectedYear === new Date().getFullYear()` | Prevents infinite loop when user manually selects a year |
| Freigrenze bar with ARIA role="progressbar" | Accessibility — screen readers announce the value |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing recharts Tooltip formatter type errors in 5 chart files**

- **Found during:** Task 1 TypeScript check
- **Issue:** `formatter={(value: number) => [...]}` incompatible with recharts `Formatter<ValueType, NameType>` which passes `ValueType | undefined`
- **Fix:** Changed to `formatter={(value) => [typeof value === 'number' ? formatEur(value) : String(value ?? ''), label]}`
- **Files modified:** GainLossBarChart.tsx, MonthlyBarChart.tsx, PnlLineChart.tsx, PortfolioDonutChart.tsx, SpotFuturesChart.tsx, YearOverYearChart.tsx
- **Commit:** 6251467

**2. [Rule 1 - Bug] Linter auto-injected unused chart imports into Dashboard.tsx**

- **Found during:** Task 2 — IDE/linter modified Dashboard.tsx between write and TS check
- **Fix:** Allowed the linter's more complete version (which already wires chart components inline) since it also satisfies the plan requirements and uses the existing CSS chart grid layout correctly
- **Net result:** Dashboard.tsx is more complete than planned (charts already wired); plan 05-05 chart-specific work may be reduced

## Next Phase Readiness

- Plan 05-05 (Charts) can build on the existing chart grid already rendered in Dashboard.tsx
- Chart components exist and type-check cleanly
- FreigrenzeBar is accessible with ARIA attributes
