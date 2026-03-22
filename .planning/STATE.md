# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 3 complete — ready for Phase 4

## Current Position

Phase: 3 of 7 (EUR Price Enrichment) — Complete
Plan: 5 of 5 in current phase
Status: Complete — all plans executed, verified (5/5 criteria passed)
Last activity: 2026-03-22 — Phase 3 verified and closed

Progress: [████████░░] 42% (21/49 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 21
- Average duration: ~7 min
- Total execution time: ~150 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 8/8 COMPLETE | ~46 min | ~6 min |
| 03-eur-price-enrichment | 5/5 COMPLETE | ~50 min | ~10 min |

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 research flag: Complex FIFO edge cases and §22 vs §23 earn income classification — consider `/gsd:research-phase` before Phase 4 planning
- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested
- German tax law: Haltefrist exact day count (>=365) and 10-year staking Haltefrist (1-year used per mainstream tools) — Steuerberater review recommended
- Migration workflow: After `npm run db:generate`, manually add STRICT to new CREATE TABLE statements

## Session Continuity

Last session: 2026-03-22
Stopped at: Phase 3 complete — all 5 plans executed, verified, state updated
Resume file: None
