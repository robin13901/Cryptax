# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 5 in progress — Summary API, format utilities, and test setup complete

## Current Position

Phase: 5 of 7 (Dashboard + Transaction UI) — In progress
Plan: 1 of 7 just completed (05-01)
Status: In progress — 05-01 complete (Summary API), 05-03 complete (format utilities)
Last activity: 2026-03-23 — Completed 05-01-PLAN.md (Summary API: GET /api/summary/:year)

Progress: [██████░░░░] 61% (30/49 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 29
- Average duration: ~8 min
- Total execution time: ~224 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 8/8 COMPLETE | ~46 min | ~6 min |
| 03-eur-price-enrichment | 5/5 COMPLETE | ~50 min | ~10 min |
| 04-fifo-engine-tax-calculation | 8/8 COMPLETE | ~61 min | ~8 min |
| 05-dashboard-transaction-ui | 3/7 in progress | ~5 min | ~5 min |

**Recent Trend:**
- Last 5 plans: 8 min
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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested
- German tax law: Haltefrist exact day count — RESOLVED: using 366 days (conservative interpretation per 04-01)
- Migration workflow: After `npm run db:generate`, manually add STRICT to new CREATE TABLE statements

## Session Continuity

Last session: 2026-03-23
Stopped at: Completed 05-01-PLAN.md (Summary API: GET /api/summary/:year, 23 tests)
Resume file: None
