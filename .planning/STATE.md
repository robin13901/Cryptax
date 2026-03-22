# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 4 in progress — FIFO Engine + Tax Calculation

## Current Position

Phase: 4 of 7 (FIFO Engine + Tax Calculation) — In progress
Plan: 3 of 8 in current phase
Status: In progress — 04-03 complete
Last activity: 2026-03-22 — Completed 04-03-PLAN.md (Futures P&L engine)

Progress: [████████░░] 47% (24/49 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 24
- Average duration: ~7 min
- Total execution time: ~163 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 8/8 COMPLETE | ~46 min | ~6 min |
| 03-eur-price-enrichment | 5/5 COMPLETE | ~50 min | ~10 min |
| 04-fifo-engine-tax-calculation | 3/8 IN PROGRESS | ~27 min | ~9 min |

**Recent Trend:**
- Last 5 plans: 8 min
- Trend: consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 03-01: date-fns-tz fromZonedTime spring-forward behaviour: treats non-existent 02:30 Berlin as 00:30 UTC
- 03-01: In-memory test migration lists must include all SQL files
- 03-01: prices/ module placed in packages/backend/src/prices/
- 03-02: Fetch DI pattern: functions accept optional fetchFn parameter
- 03-02: upsertPriceCache uses onConflictDoNothing on unique key (symbol, timestamp, source)
- 03-03: p-throttle v8 ESM static import works correctly
- 03-03: SYMBOL_OVERRIDES exported as separate constant — applied at lookup time
- 03-03: CoinGeckoOutOfRangeError thrown only for error_code 10012
- 03-04: Resolution chain: EUR self → futures USDT → CSV pair → CSV fill (EUR) → CSV fill (USDT) → cache → Bitget USDT → Bitget direct → CoinGecko
- 03-04: USDT path prioritized over direct EUR (user trades primarily in USDT)
- 03-04: CSV pair derivation matches USDT sibling at same timestamp by order_id proximity (distance < 100)
- 03-04: USDT-margined futures_tx: amount is in USDT, resolve with USDT/EUR rate directly
- 03-04: CSV USDT fill: spot_order /USDT and futures_order USDT suffix use Average Price × USDT/EUR
- 03-04: Bitget throttle 20 req/s, CoinGecko 1 req/2s (free tier limit)
- 03-05: PriceStatus polls /api/prices/status every 2s while isEnriching=true
- 03-05: POST /api/prices/enrich is fire-and-forget from frontend
- 03-05: Auto-migration via drizzle-orm migrate() in client.ts on startup
- 03-05: Concurrent enrichment guard: module-level isRunning flag, returns 409
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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 research flag: Complex FIFO edge cases and §22 vs §23 earn income classification — consider `/gsd:research-phase` before Phase 4 planning (04-01 foundation complete, proceed with planning)
- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested
- German tax law: Haltefrist exact day count — RESOLVED: using 366 days (conservative interpretation per 04-01)
- Migration workflow: After `npm run db:generate`, manually add STRICT to new CREATE TABLE statements

## Session Continuity

Last session: 2026-03-22T21:33:55Z
Stopped at: Completed 04-03-PLAN.md (Futures P&L engine, TDD RED+GREEN, 407 tests pass)
Resume file: None
