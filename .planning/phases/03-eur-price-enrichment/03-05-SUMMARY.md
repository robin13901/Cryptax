---
phase: 03-eur-price-enrichment
plan: "05"
subsystem: api
tags: [hono, sse, streaming, price-enrichment, react, glassmorphism]

# Dependency graph
requires:
  - phase: 03-04
    provides: runEnrichment engine with onProgress callback and EnrichmentDeps DI interface
provides:
  - GET /api/prices/status endpoint (counts, bySource, failureBreakdown, unresolved list)
  - POST /api/prices/enrich endpoint (fire-and-wait, concurrent guard)
  - GET /api/prices/enrich/progress SSE streaming endpoint
  - PATCH /api/prices/manual endpoint (manual EUR price entry with validation)
  - Auto-trigger of enrichment fire-and-forget after CSV import
  - PriceStatus React component (progress bar, source badges, failure breakdown, collapsible unresolved list)
  - PriceStatusResponse, EnrichmentResponse, ManualPriceEntry shared types
affects:
  - 03-06 (if further price management features needed)
  - 04-fifo-engine (consumes eur_price from enriched transactions)

# Tech tracking
tech-stack:
  added:
    - streamSSE from hono/streaming (SSE helper for Hono v4)
  patterns:
    - Concurrent-run guard: module-level isRunning flag, returns 409 if already running
    - Fire-and-forget enrichment: triggerEnrichmentBackground() exported from prices.ts, called from import.ts post-success
    - SSE streaming with streamSSE: writeSSE({ event, data }) per progress tick + complete/error terminal events
    - Manual price guard: rejects PATCH if already resolved by non-manual source

key-files:
  created:
    - packages/shared/src/types/price.ts
    - packages/backend/src/routes/prices.ts
    - packages/backend/src/routes/prices.test.ts
    - packages/frontend/src/components/PriceStatus/PriceStatus.tsx
    - packages/frontend/src/components/PriceStatus/PriceStatus.css
  modified:
    - packages/shared/src/index.ts (added price type exports)
    - packages/backend/src/index.ts (registerPriceRoutes)
    - packages/backend/src/routes/import.ts (auto-trigger after CSV import)
    - packages/frontend/src/App.tsx (PriceStatus in Transaktionen tab)

key-decisions:
  - "streamSSE from hono/streaming confirmed available in Hono v4"
  - "Auto-trigger uses exported triggerEnrichmentBackground() helper — not duplicating isRunning logic in import.ts"
  - "PATCH /api/prices/manual rejects 400 if already resolved by non-manual source; allows overwriting another manual entry"
  - "PriceFailureReason null coerced to 'unknown' in EnrichmentResponse failures mapping (type safety)"
  - "PriceStatus uses fetch() directly (no React Query) — consistent with ImportDropzone pattern"

patterns-established:
  - "SSE pattern: streamSSE(c, async (stream) => { ... stream.writeSSE({event,data}) ... }) for progress streaming"
  - "Concurrent guard pattern: module-level isRunning flag checked before starting, reset in finally block"

# Metrics
duration: 11min
completed: 2026-03-22
---

# Phase 3 Plan 05: API Routes + Frontend Price Status Summary

**Full enrichment pipeline wired: 4 API routes (status/enrich/progress SSE/manual), auto-trigger on import, PriceStatus React component with glassmorphism design.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-03-22T16:04:30Z
- **Completed:** 2026-03-22T16:15:00Z (approx, pending checkpoint approval)
- **Tasks:** 2 completed (Task 3 is checkpoint awaiting user verification)
- **Files modified:** 8 files (5 created, 3 modified)

## Accomplishments

- Created 4 REST/SSE API routes covering the full enrichment lifecycle
- Auto-trigger enrichment fire-and-forget after every CSV import
- PriceStatus frontend component with progress bar, source badges, failure breakdown, collapsible unresolved list
- 12 new backend tests (366 total, all passing)
- Biome/TypeScript clean (no new errors introduced)

## Task Commits

1. **Task 1: Price enrichment API routes + auto-trigger on import** - `5dc4827` (feat)
2. **Task 2: Frontend price status component** - `eec3d9a` (feat)
3. **Task 3: Checkpoint** - awaiting user verification

## Files Created/Modified

- `packages/shared/src/types/price.ts` - PriceStatusResponse, EnrichmentResponse, ManualPriceEntry types
- `packages/shared/src/index.ts` - Added price type exports
- `packages/backend/src/routes/prices.ts` - 4 routes + triggerEnrichmentBackground helper
- `packages/backend/src/routes/prices.test.ts` - 12 tests covering status/enrich/manual endpoints
- `packages/backend/src/index.ts` - Register registerPriceRoutes(app)
- `packages/backend/src/routes/import.ts` - Fire-and-forget auto-trigger after CSV import
- `packages/frontend/src/components/PriceStatus/PriceStatus.tsx` - Price status UI component
- `packages/frontend/src/components/PriceStatus/PriceStatus.css` - Glassmorphism styles
- `packages/frontend/src/App.tsx` - PriceStatus integrated in Transaktionen tab

## Decisions Made

1. `streamSSE` from `hono/streaming` confirmed available in Hono v4 (verified in node_modules).
2. Auto-trigger uses an exported `triggerEnrichmentBackground()` helper from `prices.ts` to avoid duplicating the `isRunning` guard in `import.ts`.
3. `PATCH /api/prices/manual` returns 400 if transaction is already resolved by a non-manual source; allows overwriting an existing manual price.
4. `PriceFailureReason` null coerced to `'unknown'` in `EnrichmentResponse.failures` mapping to satisfy the `reason: string` contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed null PriceFailureReason in EnrichmentResponse mapping**

- **Found during:** Task 1 TypeScript build check
- **Issue:** `EnrichmentResult.failures[].reason` typed as `PriceFailureReason | null` but `EnrichmentResponse.failures[].reason` requires `string`
- **Fix:** Added `?? 'unknown'` null coercion in both POST and SSE route failure mappings
- **Files modified:** `packages/backend/src/routes/prices.ts`
- **Commit:** `eec3d9a` (included in Task 2 commit)

## Next Phase Readiness

- Phase 04 FIFO engine can read `eur_price` from enriched transactions
- Note: SSE endpoint (`GET /api/prices/enrich/progress`) not covered by automated tests — testing SSE requires a real HTTP server; acceptable risk given the endpoint delegates entirely to `runEnrichment` which is thoroughly tested
