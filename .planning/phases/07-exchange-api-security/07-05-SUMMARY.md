---
phase: 07-exchange-api-security
plan: 05
subsystem: exchange
tags: [ccxt, bitget, pagination, deduplication, sync, encryption]

# Dependency graph
requires:
  - phase: 07-02
    provides: credential cipher (encryptCredentials/decryptCredentials/getCredentialMasterKey), exchange_connections schema
  - phase: 02-import-pipeline
    provides: batchInsert with onConflictDoNothing deduplication, import_batches schema

provides:
  - ExchangeAdapter interface for future exchange support
  - BitgetAdapter: ccxt bitget wrapper with spot+futures pagination
  - normalizeApiTrade: ccxt Trade -> transactions.$inferInsert conversion
  - syncExchange: full sync orchestration with partial failure handling

affects: [07-07, sync API route that exposes syncExchange]

# Tech tracking
tech-stack:
  added: [ccxt@4.5.44]
  patterns:
    - since+1 cursor pagination with empty/last-page/stuck-timestamp break conditions
    - Promise.allSettled for partial failure (spot+futures independent)
    - orderId=trade.id (fill ID) for dedup uniqueness, not trade.order (order ID)
    - SHA-256 checksum from trade.id+exchange+sourceType for deterministic dedup

key-files:
  created:
    - packages/backend/src/exchange/exchange-adapter.ts
    - packages/backend/src/exchange/bitget-adapter.ts
    - packages/backend/src/exchange/bitget-adapter.test.ts
    - packages/backend/src/exchange/normalize-api-trade.ts
    - packages/backend/src/exchange/normalize-api-trade.test.ts
    - packages/backend/src/exchange/sync-engine.ts
    - packages/backend/src/exchange/sync-engine.test.ts
  modified:
    - packages/backend/package.json
    - package-lock.json

key-decisions:
  - "07-05-a: orderId=trade.id (ccxt fill ID) not trade.order (order ID) — each fill is unique; multiple fills share the same order ID"
  - "07-05-b: Checksum uses trade.id+exchange+sourceType — deterministic dedup key without depending on mutable trade content"
  - "07-05-c: Promise.allSettled for spot+futures — partial failure imports succeeded side, adds warning for failed side"
  - "07-05-d: lastSyncAt watermark updated only when at least one side succeeds — prevents watermark advance on total failure"
  - "07-05-e: import_batches record created per sync side (spot/futures) — traceability for API-sourced trades alongside CSV batches"

patterns-established:
  - "ExchangeAdapter interface: all future exchanges implement fetchSpotTrades/fetchFuturesTrades/testConnection"
  - "since+1 cursor: advance past last trade timestamp to avoid re-fetching; break on empty/last-page/stuck"
  - "normalizeApiTrade: sourceFile=null (API trades have no file); rawRow=trade.info JSON"

# Metrics
duration: 15min
completed: 2026-03-23
---

# Phase 7 Plan 5: Bitget Adapter + Sync Engine Summary

**ccxt BitgetAdapter with since+1 pagination, normalizeApiTrade converting fills to DB rows, and syncExchange orchestrating decrypt -> fetch -> normalize -> batchInsert -> watermark with partial failure isolation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-23T19:55:00Z
- **Completed:** 2026-03-23T20:08:00Z
- **Tasks:** 2
- **Files created:** 7

## Accomplishments

- BitgetAdapter wraps ccxt `bitget` named export with spot (default params) and futures (type:swap) fetch, implementing since+1 cursor pagination with three break conditions (empty batch, last page, stuck timestamp)
- normalizeApiTrade maps ccxt Trade objects to `transactions.$inferInsert` shape: orderId from trade.id (fill ID, not order ID), all numerics as strings, deterministic checksum from trade.id+exchange+sourceType
- syncExchange orchestrates the full pipeline: load connection, decrypt credentials via getCredentialMasterKey, create BitgetAdapter, fetch spot+futures via Promise.allSettled, normalize, create import_batch records, batchInsert with deduplication, update lastSyncAt watermark

## Task Commits

Each task was committed atomically:

1. **Task 1: ExchangeAdapter interface + BitgetAdapter** - `f91da57` (feat)
2. **Task 2: API trade normalizer + sync engine** - `eac2f3c` (feat)

## Files Created/Modified

- `packages/backend/src/exchange/exchange-adapter.ts` - ExchangeAdapter interface: fetchSpotTrades, fetchFuturesTrades, testConnection
- `packages/backend/src/exchange/bitget-adapter.ts` - ccxt BitgetAdapter: spot/futures fetch with since+1 cursor pagination
- `packages/backend/src/exchange/bitget-adapter.test.ts` - 12 tests: spot/futures params, pagination pages/cursor/stuck-guard, testConnection
- `packages/backend/src/exchange/normalize-api-trade.ts` - normalizeApiTrade: ccxt Trade -> transactions.$inferInsert with null-safe defaults
- `packages/backend/src/exchange/normalize-api-trade.test.ts` - 29 tests: orderId=fill ID, all field mappings, defaults, checksum determinism
- `packages/backend/src/exchange/sync-engine.ts` - syncExchange: full orchestration with Promise.allSettled partial failure
- `packages/backend/src/exchange/sync-engine.test.ts` - 11 tests: happy path, deduplication, incremental sync, partial failure, watermark
- `packages/backend/package.json` - Added ccxt@^4.5.44 dependency

## Decisions Made

- **07-05-a: orderId=trade.id (fill ID)** — ccxt `Trade.id` is the exchange fill ID (unique per fill); `Trade.order` is the order ID (shared by multiple fills). Using fill ID ensures each row is unique. Consistent with RESEARCH.md Pitfall 6.
- **07-05-b: Checksum from trade.id+exchange+sourceType** — Deterministic dedup key that doesn't depend on trade content (price/amount can have floating-point variance across API calls). Two fills from the same exchange with the same ID will always hash identically.
- **07-05-c: Promise.allSettled for partial failure** — spot and futures fetch independently; if futures times out but spot succeeds, spot trades are imported and a warning returned. Matches CONTEXT.md requirement: "Partial import on failure".
- **07-05-d: Watermark updates only on at least one success** — prevents lastSyncAt advancing past a total failure, which would skip unretrieved trades on the next attempt.
- **07-05-e: import_batches record per sync side** — API trades get the same batch traceability as CSV imports. filename uses `api:bitget:spot:ISO` format to distinguish from file imports.

## Deviations from Plan

None — plan executed exactly as written. ccxt installed without issues (named `bitget` export confirmed). All test patterns match existing codebase conventions (vi.hoisted mockDbRef, in-memory SQLite with migrations).

## Issues Encountered

- **Test helper used `require()` for ESM module** — `insertConnection()` helper initially called `require('../auth/credential-cipher.js')` which fails in ESM. Fixed by adding a top-level `import { encryptCredentials }` at the test file level. (Rule 1 - Bug, fixed during Task 2 test iteration.)

## Next Phase Readiness

- syncExchange is ready for 07-07 to wire into POST /api/exchanges/:id/sync route
- BitgetAdapter.testConnection() is ready for 07-07 to wire POST /api/exchanges/:id/test (replacing the stub from 07-02)
- 900 total tests passing (up from 819)

---
*Phase: 07-exchange-api-security*
*Completed: 2026-03-23*
