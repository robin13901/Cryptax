---
phase: 06-steuerreport-pdf-export
plan: 04
subsystem: reporting
tags: [csv, export, typescript, steuerberater, german-locale, utf8-bom]

# Dependency graph
requires:
  - phase: 06-01
    provides: ReportData, TradeAppendixRow types from @cryptax/shared
provides:
  - buildCsv(data: ReportData): string — semicolon-delimited UTF-8 CSV with BOM
  - escapeCsvField(value: string): string — RFC-4180 field escaping helper
  - 13-column German-labeled trade appendix superset of PDF columns
  - Summary section with Freigrenze status, all three tax bucket totals
affects:
  - 06-05 (report route/endpoint that serves the CSV download)
  - 06-06 (integration tests that verify CSV output end-to-end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSV manual string building (no library) — clean for flat structured data"
    - "UTF-8 BOM prefix for German Excel auto-detection"
    - "Semicolon delimiter for German locale CSV (German Excel uses semicolons)"
    - "Dot decimal separator in CSV values (machine-readable, not display format)"
    - "RFC-4180 field escaping: wrap in double-quotes when field contains ; \" \\n \\r"

key-files:
  created:
    - packages/backend/src/report/csv-builder.ts
    - packages/backend/src/report/csv-builder.test.ts
  modified: []

key-decisions:
  - "06-04-a: Dot decimal separator in CSV (not German comma) — CSV is machine-readable import format, not display; Steuerberater software expects standard decimal notation"
  - "06-04-b: Manual string building without CSV library — flat structure has no nesting or complex quoting needs; pure function, zero dependencies"
  - "06-04-c: Summary section uses buildRow() helper for consistent escaping — even label fields pass through escapeCsvField in case of special chars"
  - "06-04-d: Blank separator row before Zusammenfassung section — visual separator in Excel, parseable via empty-line detection"
  - "06-04-e: Steuerfrei column mirrors Haltefrist erfuellt — same boolean logic, explicit separate column name for Steuerberater clarity without ambiguity"

patterns-established:
  - "BOM prefix pattern: prepend \\uFEFF to output string (not to file write call)"
  - "CRLF line ending: join lines with \\r\\n, add trailing \\r\\n"
  - "Field escaping: escapeCsvField exported for testing and reuse"
  - "Summary after blank line: standard multi-section CSV pattern"

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 06 Plan 04: CSV Export Builder Summary

**UTF-8 BOM semicolon-delimited CSV export with 13 German-labeled columns, Ja/Nein haltefrist mapping, dot decimal EUR values, and a Zusammenfassung section for Steuerberater handoff**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-23T14:00:08Z
- **Completed:** 2026-03-23T14:08:00Z
- **Tasks:** 2
- **Files modified:** 2 (created)

## Accomplishments

- `buildCsv(data: ReportData): string` — produces complete CSV string with UTF-8 BOM prefix, semicolon delimiters, CRLF line endings, and German column labels
- 13-column layout: Nr through Boerse — superset of PDF appendix columns, adds Steuerfrei explicit column and Nr sequential numbering
- Summary section at end: Steuerjahr, Spot/Futures/Earn tax totals, Freigrenze status (Eingehalten/Ueberschritten)
- 35 tests covering all edge cases: BOM, delimiter, headers, row count, Ja/Nein, dot decimal, summary, empty appendix, field escaping, sequential Nr, CRLF line endings, complete field mapping

## Task Commits

1. **Task 1: Implement CSV builder with semicolon delimiter and BOM prefix** - `a814e75` (feat)
2. **Task 2: Write comprehensive tests for CSV builder** - `ce527b1` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/backend/src/report/csv-builder.ts` — `buildCsv()` function and `escapeCsvField()` helper, no external dependencies
- `packages/backend/src/report/csv-builder.test.ts` — 35 tests across 9 describe blocks

## Decisions Made

- **06-04-a: Dot decimal separator in CSV** — The CSV is a machine-readable data import format for Steuerberater accounting software. EUR values come from MoneyString type which already uses dot notation; passing through as-is is correct. German locale display formatting belongs in the PDF, not in machine-readable CSV.
- **06-04-b: No CSV library** — The output is a flat single-level structure with no complex quoting needs. Manual string building is clean, testable, has zero runtime dependencies, and keeps the implementation transparent.
- **06-04-c: Summary section after blank separator row** — Follows the convention used in multi-section CSV exports; blank line is a reliable section delimiter parseable by both humans in Excel and downstream scripts.
- **06-04-d: Steuerfrei column explicit** — Mirrors Haltefrist erfuellt (same boolean), but the separate column name removes ambiguity for Steuerberater: "Steuerfrei" is the tax consequence, "Haltefrist erfuellt" is the legal basis. Having both avoids interpretation questions.
- **06-04-e: `escapeCsvField` exported** — Makes the escaping logic independently testable and reusable by other CSV-related code if needed.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — build clean on first attempt, all 35 tests green on first run.

## Next Phase Readiness

- `buildCsv()` is production-ready: correct BOM, delimiter, column structure, Freigrenze labels, summary section
- Backend test count: 540 (up from 505, +35 new csv-builder tests)
- Ready for 06-05 (report REST endpoint that serves CSV as download) and 06-06 (PDF builder)
- No blockers

---
*Phase: 06-steuerreport-pdf-export*
*Completed: 2026-03-23*
