---
phase: "03-eur-price-enrichment"
plan: "03"
subsystem: "prices"
tags: ["coingecko", "http-client", "rate-limiting", "p-throttle", "decimal", "tdd"]

dependency-graph:
  requires: ["03-01"]
  provides: ["coingecko-client"]
  affects: ["03-04", "03-05"]

tech-stack:
  added: []
  patterns:
    - "Injectable fetch function (fetchFn parameter) for unit-testable HTTP clients"
    - "CoinGecko DD-MM-YYYY date format for history endpoint"
    - "p-throttle wrapping for 1 req/2s rate limiting (30 req/min)"
    - "First-entry-wins deduplication for CoinGecko /coins/list symbol map"

key-files:
  created:
    - packages/backend/src/prices/coingecko-client.ts
    - packages/backend/src/prices/coingecko-client.test.ts
  modified: []

decisions:
  - id: "03-03-1"
    choice: "Static ESM import for p-throttle"
    rationale: "p-throttle v8 is ESM-only; static import works correctly in Node ESM context. Dynamic import not needed."
  - id: "03-03-2"
    choice: "Decimal.toString() (not toFixed()) for price string conversion"
    rationale: "Decimal.toString() preserves full precision without exponential notation for normal price values. toFixed() would add unnecessary trailing zeros."
  - id: "03-03-3"
    choice: "SYMBOL_OVERRIDES applied at export level (exported constant, not baked into loadCoinGeckoSymbolMap)"
    rationale: "Allows callers (enrichment orchestrator) to apply overrides at lookup time, keeping loadCoinGeckoSymbolMap pure and independently testable."
  - id: "03-03-4"
    choice: "loadCoinGeckoSymbolMap throws on network error (does not return null/empty)"
    rationale: "Startup operation — if the symbol map fails to load, enrichment cannot proceed. Caller must handle the error explicitly."

metrics:
  duration: "3m 56s"
  completed: "2026-03-22"
  tests-added: 22
  tests-passing: 22
---

# Phase 03 Plan 03: CoinGecko Historical Price Client Summary

**One-liner:** CoinGecko EUR price client with DD-MM-YYYY date formatting, CoinGeckoOutOfRangeError for 10012 code, and p-throttle at 1 req/2s.

## What Was Built

The CoinGecko historical price client (`coingecko-client.ts`) — the fallback price source for delisted or obscure tokens not available on Bitget.

**Exports:**
- `fetchCoinGeckoPrice(coinId, utcMs, fetchFn?)` — fetches daily EUR price as Decimal string, throws `CoinGeckoOutOfRangeError` for 365-day limit violations, returns null for all other failures
- `loadCoinGeckoSymbolMap(fetchFn?)` — fetches `/coins/list`, builds `Map<string, string>` from lowercase symbol to CoinGecko ID, first-entry-wins for duplicates, throws on network error
- `SYMBOL_OVERRIDES` — exported `Record<string, string>` with manual overrides for ambiguous Bitget symbols (initial entry: `comp` → `compound-governance-token`)
- `createCoinGeckoClient(fetchFn?)` — factory producing `{ fetchPrice, loadSymbolMap }` where `fetchPrice` is wrapped with `pThrottle({ limit: 1, interval: 2000 })`
- `CoinGeckoOutOfRangeError` — domain error class, thrown only for API error_code 10012

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| p-throttle import style | Static ESM import | p-throttle v8 is ESM-only; static import works correctly |
| Price string format | `Decimal.toString()` | Preserves precision without trailing zeros; no exponential notation for normal prices |
| SYMBOL_OVERRIDES placement | Exported constant (not baked into map loader) | Keeps `loadCoinGeckoSymbolMap` pure; enrichment orchestrator applies overrides at lookup time |
| `loadCoinGeckoSymbolMap` error handling | Throws on network error | Startup operation — failure must be handled explicitly by caller |

## Test Coverage

22 tests across 4 describe blocks:

| Suite | Tests |
|-------|-------|
| `fetchCoinGeckoPrice` | 11 (price return, Decimal precision, out-of-range error, missing market_data, null cases, 429, network error, URL format, DD-MM-YYYY date format) |
| `loadCoinGeckoSymbolMap` | 7 (map build, lowercasing, duplicate handling, empty response, network throw, URL check) |
| `SYMBOL_OVERRIDES` | 1 (comp override verified) |
| `createCoinGeckoClient` | 4 (interface shape, throttled fetch, unthrottled map, error propagation) |

## Deviations from Plan

### Auto-fixed Issues (Biome)

**1. [Rule 1 - Bug] Import order: p-throttle before @cryptax/shared**

- **Found during:** Biome check after GREEN phase
- **Issue:** Biome `organizeImports` requires `@cryptax/shared` before `p-throttle` (alphabetical source order)
- **Fix:** Reordered imports
- **Files modified:** `coingecko-client.ts`

**2. [Rule 1 - Bug] Test: unused `map` variable in SYMBOL_OVERRIDES test**

- **Found during:** Biome check after GREEN phase
- **Issue:** `const map = await loadCoinGeckoSymbolMap(fetch)` was assigned but not used in the assertion
- **Fix:** Removed unused variable and simplified test to directly import and check `SYMBOL_OVERRIDES.comp`
- **Files modified:** `coingecko-client.test.ts`

**3. [Rule 1 - Bug] Test: bracket notation on single-word key**

- **Found during:** Biome check after GREEN phase
- **Issue:** `SYMBOL_OVERRIDES['comp']` flagged as `lint/complexity/useLiteralKeys`
- **Fix:** Changed to `SYMBOL_OVERRIDES.comp`
- **Files modified:** `coingecko-client.test.ts`

## TDD Cycle

| Phase | Commit | Status |
|-------|--------|--------|
| RED — 22 failing tests | `c5b759c` | All failed as expected (module not found) |
| GREEN — Implementation | `067d6fd` | All 22 tests pass, Biome clean |
| REFACTOR | N/A | No structural changes needed |

## Next Phase Readiness

- `coingecko-client.ts` is ready for use by the enrichment orchestrator (plan 03-05)
- `SYMBOL_OVERRIDES` can be extended with additional ambiguous symbols as needed
- `CoinGeckoOutOfRangeError` is ready to be caught and mapped to `priceFailureReason = 'coingecko-miss'`
- p-throttle rate limiting is per-client-instance — enrichment orchestrator must use a single `createCoinGeckoClient()` instance throughout a run
