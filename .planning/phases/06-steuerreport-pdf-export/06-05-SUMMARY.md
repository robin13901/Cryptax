---
phase: 06-steuerreport-pdf-export
plan: 05
subsystem: api
tags: [hono, report, pdf, csv, routes, rest]

# Dependency graph
requires:
  - phase: 06-steuerreport-pdf-export
    plan: 01
    provides: "ReportData, SpotSummary, FuturesSummary, EarnSummary, TradeAppendixRow types"
  - phase: 06-steuerreport-pdf-export
    plan: 02
    provides: "buildPdf(data) — PDF generation from ReportData"
  - phase: 06-steuerreport-pdf-export
    plan: 03
    provides: "Trade appendix pagination in PDF"
  - phase: 06-steuerreport-pdf-export
    plan: 04
    provides: "buildCsv(data) — CSV generation from ReportData"
provides:
  - "GET /api/report/years — array of available tax years"
  - "GET /api/report/:year/preview — ReportData JSON"
  - "GET /api/report/:year/pdf — PDF binary download"
  - "GET /api/report/:year/csv — CSV text download"
  - "registerReportRoutes(app) — standard route registration pattern"
affects:
  - "06-06 — Report UI uses these 4 endpoints for preview, download, year selector"
  - "06-07 — Integration tests may target these endpoints"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted for mockDbRef — avoids TDZ with module-level singletons in Vitest"
    - "Buffer-to-ArrayBuffer conversion via .buffer.slice() for Hono body() type compatibility"
    - "BOM test via raw arrayBuffer bytes — TextDecoder strips BOM by default"

key-files:
  created:
    - packages/backend/src/routes/report.ts
    - packages/backend/src/routes/report.test.ts
  modified:
    - packages/backend/src/index.ts

key-decisions:
  - "06-05-a: getReportData helper extracts shared param parsing + ReportGenerator instantiation — avoids duplicating 400/404 logic across 3 year-based routes"
  - "06-05-b: Buffer converted to ArrayBuffer via .buffer.slice() for Hono c.body() — Hono's Data type is string|ArrayBuffer|ReadableStream|Uint8Array<ArrayBuffer>, not Buffer<ArrayBufferLike>"
  - "06-05-c: vi.hoisted mockDbRef pattern for TDZ — report-generator.ts exports a singleton (new ReportGenerator()) at module load time, which calls the db getter before let mockDb is initialized; vi.hoisted ensures the ref object exists before the mock factory runs"
  - "06-05-d: BOM assertion uses raw bytes (0xEF,0xBB,0xBF) not charCodeAt — TextDecoder.decode() strips BOM by default when no ignoreBOM option is set, making charCodeAt(0) return 'N' (header start) instead of 0xFEFF"

patterns-established:
  - "vi.hoisted mockDbRef: use { current: null as any } ref object in vi.hoisted() when mocking modules that create singletons at import time — avoids temporal dead zone with let declarations"

# Metrics
duration: 12min
completed: 2026-03-23
---

# Phase 6 Plan 5: Report API Routes Summary

**4 Hono report endpoints wiring ReportGenerator, PDF builder, and CSV builder — preview JSON, PDF binary, CSV text, and year listing**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-23T14:23:51Z
- **Completed:** 2026-03-23T14:35:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- 4 API endpoints registered via `registerReportRoutes(app)` following existing pattern
- Shared `getReportData` helper handles 400/404 logic across all 3 year-based routes
- 26 route tests covering all endpoints, error handling, headers, PDF magic bytes, CSV BOM
- vi.hoisted pattern discovered and documented for future TDZ-prone module mock scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Create report routes and register in index.ts** - `e5b362f` (feat)
2. **Task 2: Write route tests** - `7f48279` (test)

**Plan metadata:** `[pending docs commit]` (docs: complete plan)

## Files Created/Modified
- `packages/backend/src/routes/report.ts` - registerReportRoutes with 4 endpoints, getReportData helper
- `packages/backend/src/routes/report.test.ts` - 26 tests: years, preview, pdf, csv, multi-year
- `packages/backend/src/index.ts` - import and registration of registerReportRoutes

## Decisions Made

- **06-05-a: getReportData helper** — extracts shared param parsing + ReportGenerator instantiation to avoid duplicating 400/404 error logic across 3 year-based routes. Returns discriminated union `{ data }` or `{ error: Response }`.

- **06-05-b: Buffer-to-ArrayBuffer conversion** — Hono's `c.body()` `Data` type is `string | ArrayBuffer | ReadableStream | Uint8Array<ArrayBuffer>`. Node.js `Buffer` extends `Uint8Array<ArrayBufferLike>` (not `ArrayBuffer`), causing TS2769. Fix: `pdfBuffer.buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer`.

- **06-05-c: vi.hoisted mockDbRef for singleton TDZ** — `report-generator.ts` line 296 exports `const reportGenerator = new ReportGenerator()` at module load. The constructor calls the `db` getter at that time, before `let mockDb` is initialized (TDZ). Fix: wrap mockDb in a `{ current: null as any }` ref object created via `vi.hoisted()`, which runs before any module is loaded.

- **06-05-d: BOM check via raw bytes** — `res.text()` uses `TextDecoder` which strips BOM by default (web standard behavior). The BOM test reads `res.arrayBuffer()` and checks bytes `[0xEF, 0xBB, 0xBF]` (UTF-8 BOM) directly instead of using `charCodeAt(0)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Buffer type incompatibility with Hono c.body()**
- **Found during:** Task 1 (TypeScript build check)
- **Issue:** `buildPdf()` returns `Buffer<ArrayBufferLike>`, but Hono's `body()` expects `Uint8Array<ArrayBuffer>` or `ArrayBuffer` — type mismatch caused TS2769
- **Fix:** Convert Buffer to ArrayBuffer using `pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer`
- **Files modified:** packages/backend/src/routes/report.ts
- **Verification:** `npm run build -w packages/backend` succeeds with zero errors
- **Committed in:** e5b362f (Task 1 commit)

**2. [Rule 1 - Bug] BOM test assertion using charCodeAt(0) failed**
- **Found during:** Task 2 (first test run — 25/26 passing)
- **Issue:** Test expected `text.charCodeAt(0) === 0xFEFF`, but `TextDecoder.decode()` strips BOM by default (returns 'N' = ASCII 78 instead)
- **Fix:** Changed BOM test to read `arrayBuffer` directly and check raw bytes `[0xEF, 0xBB, 0xBF]` (UTF-8 BOM encoding); added `ignoreBOM: true` TextDecoder for subsequent content assertions
- **Files modified:** packages/backend/src/routes/report.test.ts
- **Verification:** All 26 tests pass including BOM test
- **Committed in:** 7f48279 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — TypeScript type fix and test assertion fix)
**Impact on plan:** Both fixes required for correctness. No scope creep.

## Issues Encountered
- Vitest vi.hoisted pattern required for mocking modules that create singletons at module load time — standard Vitest pattern, documented in decisions for reuse in future tests.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 report API endpoints live and tested
- Frontend (06-06) can immediately integrate: `/api/report/years`, `/api/report/:year/preview`, `/api/report/:year/pdf`, `/api/report/:year/csv`
- Full test suite: 712 tests passing (26 new in this plan)

---
*Phase: 06-steuerreport-pdf-export*
*Completed: 2026-03-23*
