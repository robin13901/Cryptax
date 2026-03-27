---
phase: "03"
plan: "04"
name: "Resolution Strategy + Enrichment Engine"
subsystem: "prices"
tags: ["price-resolution", "enrichment", "bitget", "coingecko", "decimal", "drizzle"]
status: complete
completed: "2026-03-22"
duration: "9 min"

dependency-graph:
  requires:
    - "03-01: timezone + symbol-parser (berlinToUtcMs, parseSymbol, usesCsvFillPrice)"
    - "03-02: bitget-client + price-cache (fetchClose, lookupPriceCache, upsertPriceCache)"
    - "03-03: coingecko-client (fetchPrice, CoinGeckoOutOfRangeError, SYMBOL_OVERRIDES)"
  provides:
    - "resolvePrice: multi-source fallback chain returning ResolutionOutcome"
    - "runEnrichment: bulk runner with progress tracking and DB updates"
    - "EnrichmentDeps: DI interface for testing and wiring"
  affects:
    - "03-05: enrichment route / SSE endpoint — wires runEnrichment to HTTP handler"

tech-stack:
  added: []
  patterns:
    - "Multi-source fallback: csv-fill → cache → bitget-direct (1min/5min) → bitget-usdt (1min/5min) → coingecko"
    - "DI pattern extended to EnrichmentDeps — all external clients injected for full test isolation"
    - "Sequential enrichment loop with per-transaction catch → api-error (never throws)"
    - "Manual overwrite: price_source='manual' rows re-queried in each run"

key-files:
  created:
    - packages/backend/src/prices/resolution-strategy.ts
    - packages/backend/src/prices/resolution-strategy.test.ts
    - packages/backend/src/prices/enrichment-engine.ts
    - packages/backend/src/prices/enrichment-engine.test.ts
  modified: []

decisions:
  - id: "03-04-a"
    decision: "USDT fallback uses Promise.all for both legs (1min), then Promise.all again for 5min — both legs MUST share the same targetMs timestamp"
    rationale: "Ensures price coherence: multiplying prices from different time points would introduce error"
  - id: "03-04-b"
    decision: "skippedCacheHit = 0 in EnrichmentResult (always zero) — resolution strategy cache hit returns early before runEnrichment sees it; tracking at engine level would require coupling"
    rationale: "Cache hits are transparent to the engine; detailed source tracking (including 'cache-hit') can be added in a later phase if needed"
  - id: "03-04-c"
    decision: "Exception catch in runEnrichment uses bare catch (not catch(err)) — Biome lint/correctness/noUnusedVariables would flag unused err"
    rationale: "The error is logged implicitly via api-error status; structured error logging deferred to Phase 7 monitoring"

metrics:
  tasks-completed: 2
  tests-added: 32
  files-created: 4
  deviations: 1
---

# Phase 03 Plan 04: Resolution Strategy + Enrichment Engine Summary

**One-liner:** Multi-source EUR price resolution (csv-fill → cache → bitget-direct → bitget-usdt → coingecko) with sequential bulk enrichment engine, DI, progress callbacks, and per-transaction error isolation.

## What Was Built

### Task 1: Resolution Strategy (`resolution-strategy.ts`)

`resolvePrice(tx, deps)` orchestrates a 5-step fallback chain:

1. **CSV fill shortcut** — `usesCsvFillPrice(sourceType, symbol, price)` → returns `{ eurPrice: tx.price, source: 'csv-fill' }` immediately
2. **Cache lookup** — `lookupPriceCache(db, bitgetSymbol, timestampMinute)` → returns cached entry if hit
3. **Bitget direct EUR** — fetches `{BASE}EUR` at 1min granularity, falls back to 5min; writes to cache on success
4. **Bitget USDT fallback** — fetches `{BASE}USDT` and `USDTEUR` at the same `targetMs` (1min then 5min); multiplies with `Decimal.js`; writes to cache with `usdtPrice` + `usdtEurRate` metadata
5. **CoinGecko** — looks up `parsedSymbol.base.toLowerCase()` in symbolMap; returns `coingecko-miss` on `CoinGeckoOutOfRangeError` or null

Returns `ResolutionOutcome = { ok: true; result } | { ok: false; failure }`. Never throws.

### Task 2: Enrichment Engine (`enrichment-engine.ts`)

`runEnrichment(db, deps, onProgress?)`:

1. Queries `WHERE eur_price IS NULL OR price_source = 'manual'` ordered by `traded_at` — incremental + manual overwrite
2. Loads CoinGecko symbol map once, applies `SYMBOL_OVERRIDES` on top
3. Iterates sequentially, calling `resolvePrice` per transaction
4. On success: `UPDATE eur_price, price_source, price_resolved_at` + clears `price_failure_reason`
5. On failure: `UPDATE price_failure_reason` + clears EUR price fields
6. Per-transaction try/catch records `api-error` and continues
7. `onProgress` callback emitted after each transaction with `{ total, processed, resolved, failed, currentSymbol, currentSource }`

Returns `EnrichmentResult` with full accounting: `total / resolved / failed / bySource / failures[]`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test expected value for Decimal precision was wrong**

- **Found during:** Task 1 tests
- **Issue:** Test expected `0.123456789 * 0.987654321 = 0.121932631112635769` but actual Decimal.js result is `0.121932631112635269` (digit 16 differs)
- **Fix:** Computed correct value by running actual Decimal.js multiplication; updated test expected value
- **Files modified:** `resolution-strategy.test.ts`
- **Commit:** bf89f7b (included in task commit)

## Test Coverage

| File | Tests | Coverage |
|------|-------|----------|
| resolution-strategy.test.ts | 21 | All 6 fallback paths + cache hit + cache write + precision |
| enrichment-engine.test.ts | 11 | Empty, mixed results, manual overwrite, progress, exception handling |
| **Total new** | **32** | |

## Key Links Established

- `resolution-strategy.ts` → `bitget-client.ts` via `fetchClose`
- `resolution-strategy.ts` → `coingecko-client.ts` via `fetchPrice` + `CoinGeckoOutOfRangeError`
- `resolution-strategy.ts` → `price-cache.ts` via `lookupPriceCache` + `upsertPriceCache`
- `enrichment-engine.ts` → `resolution-strategy.ts` via `resolvePrice`
- `enrichment-engine.ts` → `coingecko-client.ts` via `SYMBOL_OVERRIDES` + `createCoinGeckoClient`

## Next Phase Readiness

**03-05 (Enrichment Route + SSE)** can proceed:
- `runEnrichment` and `EnrichmentDeps` are stable and tested
- `onProgress` callback signature is ready for SSE streaming
- `createDefaultEnrichmentDeps(fetchFn?)` provides the production wiring
