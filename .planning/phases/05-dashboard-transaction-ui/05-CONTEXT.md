# Phase 5: Dashboard + Transaction UI - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the Dashboard and Transaktionen tabs to live calculated data from the database. Deliver: 4 KPI cards with real values, 6 Recharts visualizations, a global year selector, a filterable/searchable/sortable transaction list, and a transaction detail view with FIFO lot associations and tax impact. Creating reports, PDF export, and exchange API integration are separate phases.

</domain>

<decisions>
## Implementation Decisions

### KPI cards & year selector
- Global year selector at the top of the Dashboard — one control that filters all 4 KPI cards and all 6 charts simultaneously
- 4 KPI cards: Gesamtgewinn, Anzahl Trades, steuerpflichtiger Betrag, geschaetzte Steuer
- German locale number formatting: "1.234,56 EUR" with color coding (green = gain, red = loss)
- Each KPI card shows a small YoY change indicator (arrow + percentage vs previous year)

### Freigrenze progress indicator
- Dual progress bar showing both Spot (Paragraph 23, 1.000 EUR cliff) and Earn (Paragraph 22, 256 EUR cliff) side by side
- Color-coded: green (safe) -> amber (approaching) -> red (exceeded/cliff triggered)
- Shows EUR amount and percentage for each bucket

### Chart layout & interaction
- All 6 charts wrapped in GlassSurface cards (matching existing KPI card glassmorphism style)
- Tooltip on hover showing exact EUR value + date
- Click on a bar/point drills down — e.g. clicking a month shows that month's trades in the transaction list
- Charts: P&L over time (line), portfolio distribution (donut), gain/loss per coin (bar), monthly performance (bar), spot vs futures comparison (grouped bar), year-over-year comparison

### Transaction list
- Data table format with sortable column headers: Date, Coin, Type, Amount, EUR Value, Status
- Category badges for Spot, Futures, Earn, Fee
- Infinite scroll (not pagination)
- Import dropzone and price status moved to a separate area (sub-tab or modal) — Transaktionen tab is purely the transaction list with filters

### Transaction detail view
- Side panel (slide-in from right) — table row stays highlighted while panel is open
- FIFO lot associations displayed as a mini-table: Buy Date, Amount, Cost Basis, Gain/Loss, Haltefrist status
- Full tax breakdown: taxable gain/loss, tax bucket (Paragraph 23 / Paragraph 20 / Paragraph 22), Haltefrist met/not met, estimated tax — color-coded
- Prev/Next navigation (arrow buttons or keyboard shortcuts) to navigate between transactions without closing the panel

### Claude's Discretion
- Chart arrangement and ordering on dashboard (2-column grid, hero + grid, etc.)
- Which chart is most prominent / largest
- Filter and search bar placement for the transaction list
- How to implement the "separate import area" (sub-tab vs modal vs collapsed section)
- Loading skeletons and empty states
- Responsive breakpoints and mobile behavior
- Exact GlassSurface styling for new components

</decisions>

<specifics>
## Specific Ideas

- Existing UI uses GlassSurface component with glassmorphism, FloatingLines background, and motion/react animations — new components should match this design language
- Existing KPI cards in App.tsx are placeholder ("--" values) — replace with real data, keep GlassSurface wrappers
- Tab structure (Dashboard / Transaktionen / Steuerreport) is already in place
- Recharts is the chosen charting library per requirements

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-dashboard-transaction-ui*
*Context gathered: 2026-03-23*
