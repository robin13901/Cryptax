---
phase: 06
plan: 03
name: PDF Trade Appendix
subsystem: report-pdf
tags: [pdfkit, typescript, pdf-pagination, trade-appendix, german-tax-law, coordinate-layout]

dependency-graph:
  requires:
    - "06-02: buildPdf, sectionHeader, keyValueLine, formatEurPdf, PDFKit document setup"
    - "06-01: TradeAppendixRow type from @cryptax/shared report.ts"
  provides:
    - "buildTradeAppendix(doc, rows) — paginated table for all lot consumptions in PDF"
    - "formatDateDe(isoDate) — timezone-safe ISO → dd.MM.yyyy converter (exported)"
    - "Complete buildPdf now includes trade appendix after staking section"
  affects:
    - "06-04: ReportRoute serves full PDF including trade appendix"
    - "06-05: PDF download endpoint delivers complete Finanzamt-ready document"

tech-stack:
  added: []
  patterns:
    - "Manual coordinate-based table layout: TRADE_COL_WIDTHS array summing to CONTENT_WIDTH (495pt)"
    - "Pagination via doc.y tracking: if y + rowHeight > TRADE_PAGE_BOTTOM (770) → addPage() + header redraw"
    - "Column color coding: per-cell fillColor array indexed to column position"
    - "Tax-free row accent: 3pt green left-border strip via rect(MARGIN, y, 3, TRADE_ROW_H)"
    - "formatDateDe uses isoDate.slice(0,10) to extract YYYY-MM-DD prefix — avoids timezone shift in Date constructor"
    - "Page count test: /Type /Page(?!s) regex on latin1 buffer string — one match per page object"

file-tracking:
  created: []
  modified:
    - packages/backend/src/report/pdf-builder.ts
    - packages/backend/src/report/pdf-builder.test.ts

decisions:
  - id: "06-03-a"
    decision: "TRADE_PAGE_BOTTOM = 770pt (not PAGE_HEIGHT - 30 = 811pt) as pagination threshold"
    rationale: "Provides a generous safety margin above the footer zone (FOOTER_Y = 811pt). Each row is 14pt; triggering new page at 770 ensures no row is clipped and footer has room."
  - id: "06-03-b"
    decision: "formatDateDe uses string slice(0,10) not Date constructor for ISO parsing"
    rationale: "new Date('2024-06-20T23:59:00Z') in a UTC+X timezone would shift to June 21 local time. Slicing the ISO prefix avoids any timezone conversion — deterministic dd.MM.yyyy output regardless of server timezone."
  - id: "06-03-c"
    decision: "9-column layout: Symbol(50) + Kaufdatum(62) + Verkaufdatum(62) + Menge(50) + Einstandswert(66) + Erloes(66) + G/V(60) + Tage(30) + Haltefrist(49) = 495pt"
    rationale: "Fits A4 portrait content width (595.28 - 2*50 = 495.28pt). All financial columns right-aligned. Tage kept narrow (30pt) as integer is max 4 digits. Haltefrist 49pt fits 'Haltefrist' label."
  - id: "06-03-d"
    decision: "Tax-free rows use green left-border accent (3pt strip) instead of row background color change"
    rationale: "Alternating row backgrounds already use white/light-grey. A colored left border is visually distinct without breaking the alternating pattern or making rows hard to read."
  - id: "06-03-e"
    decision: "Page count test uses /Type /Page(?!s) negative lookahead on latin1 buffer string"
    rationale: "PDF /Pages is the page tree parent dictionary; /Page (without s) appears once per page leaf object. This reliably counts pages without decompressing content streams. Works with compress:true (default)."

metrics:
  tests-added: 12
  tests-total: 686
  duration: "4min"
  completed: "2026-03-23"
---

# Phase 6 Plan 03: PDF Trade Appendix Summary

**Paginated 9-column trade appendix table added to PDF builder — renders all FIFO lot consumptions with green/red gain-loss coloring, haltefrist accent, header repeat on page overflow, and summary totals row.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T14:15:53Z
- **Completed:** 2026-03-23T14:20:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Full trade appendix table renders in the PDF with 9 columns fitting A4 portrait (495pt content width)
- Pagination verified: `doc.y + rowHeight > 770` triggers `addPage()` + header redraw — no row clipping
- 200-row stress test passes in under 120ms; PDF valid with header repeat across pages
- `formatDateDe` helper handles ISO date-only and full datetime strings without timezone shift
- 12 new tests (pagination suite + `formatDateDe` unit tests); full project 686/686 passing

## Task Commits

1. **Task 1: Trade appendix table with pagination** - `a6abfac` (feat)
2. **Task 2: Pagination tests for 50, 100, 200+ rows** - `5f1ea04` (test)

## Files Created/Modified

- `packages/backend/src/report/pdf-builder.ts` — Added `buildTradeAppendix()`, `drawTradeTableHeader()`, `drawTradeRow()`, `formatDateDe()` and integrated into `buildPdf()` after staking section
- `packages/backend/src/report/pdf-builder.test.ts` — Added `trade appendix pagination` describe block (7 tests) and `formatDateDe` describe block (5 tests)

## Decisions Made

- **06-03-a:** TRADE_PAGE_BOTTOM = 770pt — 70pt safety margin above FOOTER_Y ensures no row overlaps footer
- **06-03-b:** `formatDateDe` uses `isoDate.slice(0,10)` split — timezone-safe date extraction
- **06-03-c:** 9-column layout summing exactly to 495pt A4 portrait content width
- **06-03-d:** Tax-free rows use 3pt green left-border accent (not row background) — compatible with alternating row pattern
- **06-03-e:** Page count via `/Type /Page(?!s)` regex — reliable without decompressing content streams

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**06-04 (PDF Route / Download Endpoint)** is already complete (executed out-of-order). The complete `buildPdf` function now includes the trade appendix, so the route serving it delivers the full Finanzamt document.

**06-05 (Steuerreport UI)** can reference the complete PDF structure when building the preview/download interface.

---
*Phase: 06-steuerreport-pdf-export*
*Completed: 2026-03-23*
