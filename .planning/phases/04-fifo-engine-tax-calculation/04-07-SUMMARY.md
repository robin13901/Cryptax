---
phase: 04-fifo-engine-tax-calculation
plan: 07
subsystem: api
tags: [hono, typescript, engine, tax-calculation, rest-api]

# Dependency graph
requires:
  - phase: 04-06
    provides: runTaxCalculation orchestrator with full pipeline
  - phase: 04-01
    provides: checkNullPrices null-price gate
  - phase: 03-05
    provides: prices route pattern (concurrent guard, 409/SSE) to follow

provides:
  - POST /api/engine/run endpoint triggering full tax calculation pipeline
  - GET /api/engine/status endpoint exposing isRunning state
  - EngineRunResponse shared type exported from @cryptax/shared
  - 422 response with structured nullPriceErrors when prices missing

affects:
  - phase-05-frontend (will call POST /api/engine/run and poll GET /api/engine/status)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine route follows prices.ts concurrent guard pattern: module-level isRunning, 409 on conflict"
    - "Pre-flight checkNullPrices in route (not inside engine) gives structured 422 data"
    - "Promise.resolve() wrapping of sync function enables async mock testing for 409 concurrent guard"

key-files:
  created:
    - packages/backend/src/routes/engine.ts
    - packages/backend/src/routes/engine.test.ts
    - packages/shared/src/types/engine.ts
  modified:
    - packages/backend/src/index.ts
    - packages/shared/src/index.ts

key-decisions:
  - "04-07: Route calls checkNullPrices directly (before runTaxCalculation) to get structured NullPriceError data for 422 response — engine's own null check is a duplicate guard"
  - "04-07: Promise.resolve() wraps sync runTaxCalculation call in route handler — allows async mock in 409 concurrent test without changing sync semantics in production"
  - "04-07: EngineRunResponse.nullPriceErrors is optional (only present on 422) — success path omits the field"

patterns-established:
  - "Engine route: same module-level isRunning guard as prices route, same 409 error message pattern"
  - "422 is the canonical status for NULL price pre-flight failures"

# Metrics
duration: 6min
completed: 2026-03-22
---

# Phase 4 Plan 7: Engine API Route Summary

**POST /api/engine/run and GET /api/engine/status Hono routes with 409 concurrent guard and 422 null-price pre-flight check backed by EngineRunResponse shared type**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-22T21:53:46Z
- **Completed:** 2026-03-22T22:00:21Z
- **Tasks:** 2
- **Files modified:** 5 (2 created new routes + 3 modified)

## Accomplishments

- `EngineRunResponse` shared type added to `@cryptax/shared` covering summaries, per-engine counts, nullPriceErrors, and errors
- `POST /api/engine/run` calls `checkNullPrices` first — returns structured 422 if any taxable transaction is missing EUR price; otherwise runs full `runTaxCalculation` and returns 200
- `GET /api/engine/status` exposes `{ isRunning }` for frontend polling
- Concurrent guard (module-level `isRunning`) returns 409 when engine already running
- 7 tests covering 200/409/422 paths, isRunning reset after both success and 422, and spy call count verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared engine response type** - `e905201` (feat)
2. **Task 2: Implement engine route and register it** - `37bd53a` (feat)

**Plan metadata:** (to be set after docs commit)

## Files Created/Modified

- `packages/shared/src/types/engine.ts` - EngineRunResponse interface
- `packages/shared/src/index.ts` - Added EngineRunResponse export (sorted)
- `packages/backend/src/routes/engine.ts` - Engine API route (registerEngineRoutes)
- `packages/backend/src/routes/engine.test.ts` - 7 route tests
- `packages/backend/src/index.ts` - registerEngineRoutes(app) registration

## Decisions Made

- Route calls `checkNullPrices(db)` directly before `runTaxCalculation` to obtain structured `NullPriceError[]` data for the 422 response body. The engine's internal null check still acts as a safety net but the route's pre-flight gives the caller transaction-level diagnostic data.
- `Promise.resolve()` wraps the synchronous `runTaxCalculation` call in the async route handler. This has zero production overhead but allows the 409 concurrent guard test to use a hanging Promise mock (same test pattern as `prices.test.ts`).
- `nullPriceErrors` field in `EngineRunResponse` is typed as optional (`nullPriceErrors?`) — only included in 422 responses, absent on 200 success to keep the success payload clean.

## Deviations from Plan

None — plan executed exactly as written. The `Promise.resolve()` wrapping and test mock approach were minor implementation details decided during coding, not deviations from plan intent.

## Issues Encountered

- Lint reported 3 issues in engine.test.ts: unused `transactions` import, two non-null assertions (`!`), and unsorted imports. Fixed before commit: removed unused import, replaced `!` with `?.`, reorganized import order to match biome's sorted order.
- `vi.clearAllMocks()` was needed in `beforeEach` — mock spy call counts from prior tests in the same file were accumulating, causing "called 2 times" failures. Added explicitly.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `POST /api/engine/run` is fully functional and ready for frontend integration in Phase 5
- Frontend needs to: POST to trigger, poll `GET /api/engine/status` for progress, handle 409 (already running) and 422 (unresolved prices) states
- All 467 tests pass, lint clean on modified files

---
*Phase: 04-fifo-engine-tax-calculation*
*Completed: 2026-03-22*
