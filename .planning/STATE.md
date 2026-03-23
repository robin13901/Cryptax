# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 5 COMPLETE and VERIFIED — ready for Phase 6

## Current Position

Phase: 5 of 7 (Dashboard + Transaction UI) — Complete
Plan: 7 of 7 complete (05-07)
Status: Complete — all plans executed, verified (5/5 criteria passed after gap fix)
Last activity: 2026-03-23 — Phase 5 verified and closed

Progress: [███████░░░] 73% (36/49 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 33
- Average duration: ~8 min
- Total execution time: ~240 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 8/8 COMPLETE | ~46 min | ~6 min |
| 03-eur-price-enrichment | 5/5 COMPLETE | ~50 min | ~10 min |
| 04-fifo-engine-tax-calculation | 8/8 COMPLETE | ~61 min | ~8 min |
| 05-dashboard-transaction-ui | 7/7 COMPLETE | ~75 min | ~11 min |

**Recent Trend:**
- Last 5 plans: 10 min
- Trend: consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 04-01: HALTEFRIST_DAYS=366 — conservative: Jan 1 buy is tax-free Jan 2 next year (366 days elapsed)
- 04-01: Decimal import in NodeNext must be named export { Decimal } from 'decimal.js' — default/re-export resolves to namespace only
- 04-01: checkNullPrices returns empty array on pass, array of NullPriceError on failure — caller decides abort
- 04-01: SKIPPABLE_CANONICAL_TYPES = transfer_in/out, earn_withdrawal, fee, unknown — intentionally excluded from NULL price check
- 04-02: Fee conversion uses eurPrice multiplier for both spot_tx and spot_order (feeEur = fee * eurPrice) — consistent approximation
- 04-02: Excess sell generates both consumption records AND sellsWithoutLots entry — partial match + error flag
- 04-02: FIFO tiebreak: buys (key=0) before sells (key=1) at same timestamp
- 04-03: Futures opens (open_long/short) skipped — opening a position is not a taxable event under German law
- 04-03: Fee sign convention: feeEur stored as positive abs() value; source amounts are negative but reporting uses positive fees
- 04-03: Set-based FUTURES_TAXABLE_TYPES guard — clean O(1) filter over switch/if chains
- 04-04: Freigrenze cliff uses netGainEur only (haltefristMet=false records); tax-free gains excluded from net entirely
- 04-04: Haltefrist-met losses are ignored (no tax benefit, no liability); only non-exempt records enter netting
- 04-04: tradeCount via Set<number> on sellTransactionId — unique sells, not lot pairings
- 04-05: Freigrenze not applied in earn engine — deferred to orchestrator for per-year aggregate cliff check
- 04-05: earn_withdrawal skipped with specific reason (distinguishes from generic non-earn skip)
- 04-05: FIFO lot feeEur = ZERO — earn has no acquisition cost beyond the fair market value
- 04-05: costPerUnitEur = eurPrice directly — cost basis is purely fair market value at receipt (no fee adjustment)
- 04-06: Earn lots fed into FIFO via synthetic buy transactions (canonicalType='buy') — earn engine still runs separately for §22 income records
- 04-06: §23 estimatedTaxEur = 0 — marginal rate unknown; only Abgeltungssteuer (futures, 26.375%) is computable without user tax data
- 04-06: Earn Freigrenze cliff at 256 EUR applied at orchestrator level per-year aggregate
- 04-06: Futures net P&L = sum(realizedPnlEur) - sum(feeEur) per year; only positive net is taxable (no Freigrenze)
- 04-06: DB writes inside single db.transaction() — atomic: either all 5 tables written or none
- 04-08: Golden master tests reuse in-memory SQLite + full migrations pattern — no mocking
- 04-08: Property tests target runFifoEngine directly (pure function, no DB) — faster, 100 runs each
- 05-01: engineHasRun guard uses SELECT 1 FROM tax_summaries LIMIT 1 — cheapest probe, distinguishes no-engine-run from zero-gains
- 05-01: Portfolio allocation is year-agnostic — shows current open holdings across all tax years
- 05-01: KPI sum uses parseFloat — engine stores precise Decimal strings; float sum adequate for dashboard display
- 05-03: jsdom renders de-DE currency as '€' symbol not 'EUR' text — test assertions use /EUR|€/ regex for portability
- 05-03: gainLossColor returns CSS variable strings (var(--crypto-green/red)) not hex — theming via CSS custom properties
- 05-03: formatEur showSign defaults false; callers pass true for P&L display contexts
- 05-03: ResizeObserver/IntersectionObserver mocks added to shared setup.ts (not per-file) — project-wide availability

- 05-02: Numeric sort uses CAST(col AS REAL) — amount/eurPrice stored as TEXT, lexicographic sort would break ordering
- 05-02: taxImpact computed per-request from lotConsumptions/futuresPositions/earnIncome — no pre-computed column needed
- 05-02: haltefristMet converted via Boolean() — SQLite stores as 0/1 integer in raw queries
- 05-02: TransactionListItem extended with orderId, sourceType, eurPrice for list display badges

- 05-04: Dashboard auto-selects most recent year only when selectedYear equals current calendar year — avoids infinite loop on manual selection
- 05-04: FreigrenzeBar thresholds pct < 70 green, 70-89 amber (#f59e0b), >= 90 red — standard warning UX
- 05-04: recharts Tooltip formatter type: use `(value) => [typeof value === 'number' ? formatEur(value) : ...]` — ValueType is `number | undefined`

- 05-05: MonthlyBarChart losses sign: API returns losses as negative MoneyStrings; Math.abs() applied for stacked bar height
- 05-05: PnlLineChart cumulative: gains + losses (losses already negative) accumulated per month as running sum
- 05-05: SpotFuturesChart bucket lookup: buckets.find(b => b.bucket === 'private_sale') — defensive against API ordering changes
- 05-05: Chart grid wide class: className="chart-card--wide" forwarded through ChartCard to GlassSurface; CSS grid-column: 1/-1

- 05-06: CategoryBadge uses CSS class-based color mapping — enables theming and specificity control
- 05-06: IntersectionObserver on sentinel div for infinite scroll — zero scroll-event listener overhead
- 05-06: AbortController per fetch — prevents stale result race conditions on filter change
- 05-06: availableYears extracted from first page response — avoids separate /api/years endpoint
- 05-06: Import section wrapped in <details> toggle — preserves import functionality without dominating the tab

- 05-07: TransactionDetail returns null when transactionId=null — AnimatePresence exit animation handled by parent (TransactionList)
- 05-07: vi.spyOn(global, 'fetch') preferred over vi.stubGlobal — vi.restoreAllMocks() cleans up spyOn but not stubGlobal
- 05-07: Global cleanup() in setup.ts afterEach — project-wide DOM isolation without per-file boilerplate

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested
- German tax law: Haltefrist exact day count — RESOLVED: using 366 days (conservative interpretation per 04-01)
- Migration workflow: After `npm run db:generate`, manually add STRICT to new CREATE TABLE statements

## Session Continuity

Last session: 2026-03-23
Stopped at: Completed 05-07-PLAN.md (TransactionDetail slide-in panel + 59 component tests; phase 5 complete)
Resume file: None
