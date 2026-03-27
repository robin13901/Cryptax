---
phase: 03-eur-price-enrichment
plan: "02"
subsystem: api
tags: [bitget, price-cache, sqlite, drizzle, p-throttle, fetch, tdd, rate-limiting]

requires:
  - phase: 03-01
    provides: "prices/ module skeleton, priceCache schema, symbol-parser, timezone utils"
  - phase: 01-03
    provides: "Drizzle ORM setup, SQLite migrations, DB_PATH env var for test isolation"

provides:
  - "fetchBitgetCandleClose: HTTP client for Bitget history-candles endpoint, DI fetch, null-safe"
  - "createBitgetClient: throttled client (10 req/s via p-throttle) wrapping fetchBitgetCandleClose"
  - "lookupPriceCache: Drizzle select by (symbol, timestamp) with LIMIT 1"
  - "upsertPriceCache: Drizzle insert with onConflictDoNothing for dedup on (symbol, timestamp, source)"
  - "PriceCacheEntry / PriceCacheInsert TypeScript types"

affects:
  - "03-03 (resolution strategy)"
  - "03-04 (USDT fallback)"
  - "03-05 (enrichment orchestrator)"

tech-stack:
  added: []
  patterns:
    - "Dependency injection for fetch function — pass fetchFn parameter for testability without global mocking"
    - "p-throttle wrapping in factory function — createBitgetClient returns throttled interface"
    - "onConflictDoNothing for price cache dedup — unique key (symbol, timestamp, source)"
    - "Drizzle and(eq(), eq()) pattern for two-field lookup"

key-files:
  created:
    - packages/backend/src/prices/bitget-client.ts
    - packages/backend/src/prices/bitget-client.test.ts
    - packages/backend/src/prices/price-cache.ts
    - packages/backend/src/prices/price-cache.test.ts
  modified: []

key-decisions:
  - "Dependency injection (fetchFn parameter) for HTTP in fetchBitgetCandleClose — avoids global fetch mocking, deterministic tests"
  - "createBitgetClient accepts optional fetchFn to propagate DI into throttled wrapper"
  - "fetchBitgetCandleClose wraps entire body in try-catch — network errors return null, never throw"
  - "Closest-candle selection by |candle[0] - targetMs| linear scan — simple and correct for limit=5 responses"
  - "price-cache.ts exports async functions using Drizzle ORM (not raw SQL) — consistent with rest of codebase"
  - "lookupPriceCache returns first matching row regardless of source — caller specifies source lookup when needed"

patterns-established:
  - "Fetch DI pattern: all HTTP clients in prices/ accept optional fetchFn for test injection"
  - "Null-safety: all external API calls return null on any error, never throw"
  - "Rate-limit factory pattern: createXxxClient() returns throttled interface object"

duration: 7min
completed: 2026-03-22
---

# Phase 3 Plan 02: Bitget Candle Client + Price Cache Summary

**Bitget history-candles HTTP client with DI fetch + p-throttle (10 req/s), and SQLite price cache with Drizzle onConflictDoNothing dedup**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-22T15:41:48Z
- **Completed:** 2026-03-22T15:48:24Z
- **Tasks:** 2 (2 TDD pairs)
- **Files modified:** 4 created

## Accomplishments

- `fetchBitgetCandleClose(symbol, targetMs, granularity?, fetchFn?)` fetches Bitget `/api/v2/spot/market/history-candles`, selects the candle with open time closest to `targetMs`, returns close price (index 4) as string or null
- `createBitgetClient(fetchFn?)` wraps the above with `p-throttle({ limit: 10, interval: 1000 })`, returning `{ fetchClose }` — the primary price-fetch interface for 03-03+
- `lookupPriceCache(db, symbol, timestampMinute)` performs Drizzle select with `and(eq(symbol), eq(timestamp))` cache-first lookup
- `upsertPriceCache(db, entry)` inserts with `onConflictDoNothing` — duplicate (symbol, timestamp, source) rows silently skipped
- 21 tests total (12 bitget-client, 9 price-cache) all green; Biome clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Bitget Candle API Client** - `c92d5b2` (feat)
2. **Task 2: Price Cache Layer** - `43d4388` (feat)

_Note: Both TDD tasks produced single feat commits (test + implementation committed together after GREEN phase confirmed)_

## Files Created/Modified

- `/packages/backend/src/prices/bitget-client.ts` - `fetchBitgetCandleClose` + `createBitgetClient` with p-throttle
- `/packages/backend/src/prices/bitget-client.test.ts` - 12 tests covering success, 40034 error, empty data, multi-candle selection, granularity forwarding, network error, URL construction
- `/packages/backend/src/prices/price-cache.ts` - `lookupPriceCache` + `upsertPriceCache` with Drizzle, exports `PriceCacheEntry`/`PriceCacheInsert` types
- `/packages/backend/src/prices/price-cache.test.ts` - 9 tests covering miss/hit, wrong symbol/timestamp, USDT fields, duplicate insert, multi-source storage

## Decisions Made

- **DI fetch parameter**: `fetchFn` defaults to `globalThis.fetch` but can be overridden in tests — avoids global fetch mocking, no `vi.spyOn(global, 'fetch')` needed. `createBitgetClient` accepts optional `fetchFn` and propagates it into the throttled closure.
- **Null-safe by design**: `fetchBitgetCandleClose` wraps the entire body in try-catch — network errors, JSON parse failures, and unknown codes all return `null`, never throw. Callers don't need to handle exceptions.
- **Closest-candle by linear scan**: `|Number(candle[0]) - targetMs|` over 5 results maximum — readable, correct, no complexity needed at this data scale.
- **lookupPriceCache returns first row**: The unique key includes source, so multiple sources can coexist for the same (symbol, timestamp). The resolution strategy (03-03) will call lookup with a specific source when order matters.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Biome CRLF/LF: On Windows, git's `core.autocrlf` stores CRLF in index, but `npx biome format --write` writes LF. After formatting, `git status` shows all prices/ files as modified (CRLF vs LF in working tree). The content is identical; this is a cosmetic git status artifact. The files are Biome-clean (passes `biome check`). Previous-phase files (coingecko-client, symbol-parser, timezone) were already affected by this — no code change committed for them.

## Next Phase Readiness

- `fetchBitgetCandleClose` and `createBitgetClient` ready for 03-03 resolution strategy
- `lookupPriceCache` / `upsertPriceCache` ready for cache-first lookup in resolution orchestrator
- Both modules are fully tested with mocked HTTP and in-memory SQLite respectively
- No blockers

---
*Phase: 03-eur-price-enrichment*
*Completed: 2026-03-22*
