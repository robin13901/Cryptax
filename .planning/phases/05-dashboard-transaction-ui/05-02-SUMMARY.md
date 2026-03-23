---
phase: 05-dashboard-transaction-ui
plan: 02
subsystem: api
tags: [hono, drizzle, sqlite, typescript, pagination, fifo, transactions]

# Dependency graph
requires:
  - phase: 04-fifo-engine-tax-calculation
    provides: lotConsumptions, fifoLots, futuresPositions, earnIncome tables populated by tax engine
  - phase: 02-csv-import-pipeline
    provides: transactions table with all imported transaction rows
  - phase: 03-eur-price-enrichment
    provides: eurPrice column on transactions
provides:
  - GET /api/transactions endpoint with pagination, filtering, search, sort
  - GET /api/transactions/:id endpoint with FIFO lot detail and taxImpact
  - TransactionPageResponse, TransactionDetailResponse, LotConsumptionDetail shared types
  - TransactionListItem extended with orderId, sourceType, eurPrice
affects:
  - 05-dashboard-transaction-ui plans 03+: frontend Transaktionen tab uses these endpoints
  - Future phases needing transaction detail views or tax impact per transaction

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Drizzle CAST(col AS REAL) for numeric sort on TEXT money columns
    - in-memory SQLite + full migrations pattern for route integration tests
    - taxImpact computed at query time from joined engine tables (no pre-computed column)

key-files:
  created:
    - packages/backend/src/routes/transactions.ts
    - packages/backend/src/routes/transactions.test.ts
  modified:
    - packages/shared/src/types/transaction.ts
    - packages/shared/src/index.ts
    - packages/backend/src/index.ts

key-decisions:
  - "05-02: Numeric sort uses CAST(col AS REAL) — amount/eurPrice stored as TEXT, lexicographic sort would break ordering"
  - "05-02: taxImpact computed per-request from lotConsumptions/futuresPositions/earnIncome — no pre-computed column needed"
  - "05-02: haltefristMet converted via Boolean() — SQLite stores as 0/1 integer (mode:'boolean' returns number in raw queries)"
  - "05-02: TransactionListItem extended with orderId, sourceType, eurPrice — needed for list display badges"

patterns-established:
  - "Route module pattern: registerXRoutes(app: Hono) — consistent with engine.ts, summary.ts"
  - "Test pattern: vi.mock('../db/client.js') + in-memory SQLite + applyMigrations — no test DB on disk"

# Metrics
duration: 18min
completed: 2026-03-23
---

# Phase 5 Plan 02: Transactions API Summary

**Hono GET /api/transactions (paginated list) and GET /api/transactions/:id (FIFO detail + taxImpact) with 22 route tests, numeric sort via CAST(AS REAL), and extended TransactionListItem shared type**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-23T09:09:16Z
- **Completed:** 2026-03-23T09:14:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added three new shared types to `@cryptax/shared`: `TransactionPageResponse`, `TransactionDetailResponse`, `LotConsumptionDetail`
- Extended `TransactionListItem` with `orderId`, `sourceType`, and `eurPrice` fields for list display
- Implemented `GET /api/transactions` with year/type/coin/date-range filters, LIKE search on symbol+orderId, numeric sort via `CAST(col AS REAL)`, and limit/offset pagination
- Implemented `GET /api/transactions/:id` joining lotConsumptions→fifoLots, querying futuresPositions and earnIncome, computing taxImpact bucket+flags per-request
- 22 integration tests covering all filter/sort/search paths, pagination, 404, FIFO lot data, futures P&L, earn income, and taxImpact computation

## Task Commits

1. **Task 1: Add TransactionPageResponse and TransactionDetailResponse types** - `5529f5f` (feat)
2. **Task 2: Implement transaction list and detail API routes with tests** - `f8465c2` (feat)

## Files Created/Modified
- `packages/shared/src/types/transaction.ts` — Extended TransactionListItem; added TransactionPageResponse, LotConsumptionDetail, TransactionDetailResponse
- `packages/shared/src/index.ts` — Export three new types
- `packages/backend/src/routes/transactions.ts` — registerTransactionRoutes with GET list and GET :id
- `packages/backend/src/routes/transactions.test.ts` — 22 integration tests
- `packages/backend/src/index.ts` — Register registerTransactionRoutes(app)

## Decisions Made
- **Numeric sort via CAST**: `amount` and `eurPrice` are stored as TEXT (MoneyString). Sorting them lexicographically would break ordering ("9" > "10"). Used `sql\`CAST(${col} AS REAL)\`` to sort numerically.
- **taxImpact computed at request time**: Joining lotConsumptions, futuresPositions, and earnIncome tables on each detail request is fast enough for a single-transaction lookup. No need for a pre-computed column.
- **Boolean conversion for haltefristMet**: Drizzle's `mode: 'boolean'` applies only to ORM queries. Raw `sqlite.prepare().run()` in tests inserts 0/1 integers. The route uses `Boolean(l.haltefristMet)` to safely handle both.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Both transaction endpoints are live at `GET /api/transactions` and `GET /api/transactions/:id`
- All 532 project tests pass (22 new)
- Frontend Transaktionen tab (plan 05-04+) can immediately consume these endpoints
- No blockers

---
*Phase: 05-dashboard-transaction-ui*
*Completed: 2026-03-23*
