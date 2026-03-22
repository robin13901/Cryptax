---
phase: 02-csv-import-pipeline
verified: 2026-03-22T08:55:34Z
status: gaps_found
score: 4/5 success criteria verified
gaps:
  - truth: "Rows with unrecognized type strings are flagged in the import summary"
    status: partial
    reason: "Rows with missing required fields (order, date, type, amount) ARE flagged in ImportSummary errors[]. However, rows with unrecognized type strings get canonicalType=unknown and are inserted silently. They do NOT appear in the import summary. PerFileResult has no flaggedCount field. CONTEXT.md specified that unmapped rows must be visible in the import summary."
    artifacts:
      - path: "packages/backend/src/import/orchestrator.ts"
        issue: "Collects parser errors but does not count or surface unknown-canonical-type row counts in PerFileResult"
      - path: "packages/shared/src/types/import.ts"
        issue: "PerFileResult interface has no flaggedCount or unknownTypeCount field"
      - path: "packages/frontend/src/components/ImportSummary/ImportSummary.tsx"
        issue: "Only renders errors[] from PerFileResult - no UI element for unknown/unmapped canonical type rows"
    missing:
      - "A flaggedCount or unknownTypeCount field on PerFileResult"
      - "Orchestrator logic to count rows where mapCanonicalType returns unknown"
      - "ImportSummary UI element surfacing that count"
---
# Phase 2: CSV Import Pipeline - Verification Report

**Phase Goal:** A user can drag and drop (or file-pick) any of the 5 Bitget CSV export formats and have all transactions correctly parsed, normalized into a unified schema, deduplicated, and stored in SQLite with an import summary showing rows accepted, skipped, and flagged.

**Verified:** 2026-03-22T08:55:34Z
**Status:** gaps_found
**Re-verification:** No - initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dropping 2024 (semicolon, BOM) and 2025 (comma) spot CSVs both import with zero dropped rows and correct canonical types | VERIFIED | detectDelimiter + detectFormat confirmed for both variants. parseRawCSV passes bom:true, trim:true. Human verification confirmed ~572 / ~889 rows. Real fixtures exist at raw-bitget-exports/. |
| 2 | Importing the same CSV twice skips all previously imported rows and shows duplicate count | VERIFIED | batchInsert uses onConflictDoNothing() on unique constraint (order_id, exchange, checksum). Orchestrator test confirms second import: 0 imported, N duplicates. ImportSummary renders duplicatesSkipped count per file. |
| 3 | All 5 Bitget CSV formats are auto-detected by header signature | VERIFIED | detectFormat checks most-specific-first column signatures. 16 detect-format tests pass covering all 5 formats, BOM variants, and delimiter variants. |
| 4 | Rows with missing or invalid critical fields are flagged in import summary | PARTIAL | Parser errors for missing required fields surface in ImportSummary errors[]. Rows with unrecognized type strings get canonicalType=unknown and are inserted but NOT flagged in summary. CONTEXT.md requires unmapped rows visible in the import summary. |
| 5 | Transactions from 2024 and 2025 CSVs are tagged with correct tax year and separately filterable | VERIFIED | normalizeToTransaction extracts taxYear = parseInt(tradedAt.substring(0,4), 10). transactions.taxYear is NOT NULL with idx_transactions_tax_year index. taxYear extraction tests pass for 2023/2024/2025. |

**Score:** 4/5 truths verified (1 partial gap)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|----------|
| packages/backend/drizzle/0001_import_batches.sql | Migration: import_batches STRICT + batch_id FK | VERIFIED | EXISTS 13 lines. Contains STRICT, ALTER TABLE ADD batch_id, CREATE INDEX idx_transactions_batch_id |
| packages/shared/src/types/import.ts | ImportBatch, PerFileResult, ImportFileError, ImportResponse | VERIFIED | EXISTS 45 lines. All 4 interfaces substantive, exported from @cryptax/shared barrel |
| packages/backend/src/db/schema.ts | importBatches table + batchId FK on transactions | VERIFIED | EXISTS 187 lines. Unique constraint uq_transaction_order_exchange_checksum on (orderId, exchange, checksum). taxYear NOT NULL indexed. |
| packages/backend/src/import/parsers/spot-tx.ts | parseSpotTx, ParsedSpotTx | VERIFIED | EXISTS 144 lines. Case-insensitive key normalisation, tab-strip, required field validation. Both 2024/2025 delimiter variants handled. |
| packages/backend/src/import/parsers/futures-tx.ts | parseFuturesTx, ParsedFuturesTx | VERIFIED | EXISTS 137 lines. All 9 raw type strings including risk_captital_user_transfer typo preserved. |
| packages/backend/src/import/parsers/spot-order.ts | parseSpotOrder, ParsedSpotOrder | VERIFIED | EXISTS 108 lines. Average Price as fill price, Direction as rawType, symbol derived as BASE/QUOTE. |
| packages/backend/src/import/parsers/futures-order.ts | parseFuturesOrder, ParsedFuturesOrder | VERIFIED | EXISTS 136 lines. All 4 Direction values. Empty Average Price for Market orders is not an error. |
| packages/backend/src/import/parsers/earn.ts | parseEarn, ParsedEarn | VERIFIED | EXISTS 134 lines. Clean Reference (no tab), separate coin/interestCoin fields. |
| packages/backend/src/import/detect-format.ts | detectFormat, detectDelimiter | VERIFIED | EXISTS 64 lines. Most-specific-first detection. BOM-aware. Throws on unknown format. |
| packages/backend/src/import/type-map.ts | CANONICAL_TYPE_MAP (22 entries), mapCanonicalType | VERIFIED | EXISTS 85 lines. All 22 raw type strings across 5 formats. unknown fallback. Bitget typo preserved. |
| packages/backend/src/import/normalize.ts | normalizeToTransaction for all 5 formats | VERIFIED | EXISTS 216 lines. price/totalValue default to 0. taxYear extraction. Per-format symbol/orderId/fee derivation. |
| packages/backend/src/import/checksum.ts | computeChecksum SHA-256 | VERIFIED | EXISTS 23 lines. SHA-256 of JSON.stringify(row). Deterministic. |
| packages/backend/src/import/parse-csv.ts | parseRawCSV orchestrator | VERIFIED | EXISTS 46 lines. Delimiter-detect then format-detect then csv-parse with bom/trim/skip_empty_lines. |
| packages/backend/src/import/insert.ts | batchInsert with onConflictDoNothing | VERIFIED | EXISTS 57 lines. Chunks of 200. Single db.transaction(). Returns inserted/duplicates counts. |
| packages/backend/src/import/orchestrator.ts | importCSVFile full pipeline | VERIFIED | EXISTS 156 lines. Ties detect->parse->normalize->insert. Creates/updates import_batches. Graceful error handling for unknown format. |
| packages/backend/src/routes/import.ts | registerImportRoutes (POST, GET, DELETE) | VERIFIED | EXISTS 89 lines. POST /api/import/csv, GET /api/import/batches, DELETE /api/import/batches/:id with atomic transaction. |
| packages/frontend/src/components/ImportDropzone/ImportDropzone.tsx | Drag and drop + file picker | VERIFIED | EXISTS 123 lines. HTML5 drag handlers, browse button type=button, multi-file FormData, progress text, CSV filter. |
| packages/frontend/src/components/ImportSummary/ImportSummary.tsx | Import results display | VERIFIED | EXISTS 121 lines. Combined totals (imported/duplicates/errors), per-file expandable breakdown, sourceType badges, dismiss button. |
| packages/backend/src/import/index.ts | Barrel export for import module | VERIFIED | EXISTS 7 lines. Exports all 9 import module symbols. |
| packages/backend/src/index.ts | registerImportRoutes wired to server | VERIFIED | Line 14: registerImportRoutes(app) called after registerHealthRoutes. |
| packages/frontend/src/App.tsx | ImportDropzone + ImportSummary in Transaktionen tab | VERIFIED | importResponse state. Conditional render: ImportSummary when set, ImportDropzone when null. onDismiss clears state. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|----------|
| ImportDropzone.tsx | /api/import/csv | fetch POST FormData | WIRED | fetch POST with FormData body. Response handled as ImportResponse, calls onImportComplete. |
| routes/import.ts | orchestrator.ts | importCSVFile() | WIRED | Line 36: importCSVFile(text, file.name) called per file in Promise.all |
| orchestrator.ts | parse-csv.ts | parseRawCSV() | WIRED | Line 39: const parsed = parseRawCSV(fileText) |
| orchestrator.ts | insert.ts | batchInsert() | WIRED | Line 134: const insertResult = batchInsert(normalizedRows, batch.id) |
| normalize.ts | type-map.ts | mapCanonicalType() | WIRED | Line 77: const canonicalType = mapCanonicalType(format, rawType) |
| normalize.ts | checksum.ts | computeChecksum() | WIRED | Line 99: checksum: computeChecksum(rawCsvRow) |
| backend/src/index.ts | routes/import.ts | registerImportRoutes(app) | WIRED | Line 14: registerImportRoutes(app) |
| App.tsx | ImportDropzone | import + JSX render | WIRED | Imported line 6, rendered at line 153 when importResponse is null |
| App.tsx | ImportSummary | import + JSX render | WIRED | Imported line 7, rendered at line 148 when importResponse is set |

---

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| IMPT-01 | SATISFIED | spot-tx.ts handles BOM/semicolon/comma/tab-strip |
| IMPT-02 | SATISFIED | futures-tx.ts with all 9 type strings |
| IMPT-03 | SATISFIED | spot-order.ts with Average Price + BASE/QUOTE symbol |
| IMPT-04 | SATISFIED | futures-order.ts with realizedPnl/netProfits |
| IMPT-05 | SATISFIED | earn.ts with clean reference + interestCoin |
| IMPT-06 | SATISFIED | detect-format.ts auto-detects all 5 formats by header signature |
| IMPT-07 | SATISFIED | normalize.ts + type-map.ts unify all 5 formats into transactions schema |
| IMPT-08 | SATISFIED | ImportDropzone with drag-and-drop and file picker |
| IMPT-09 | SATISFIED | onConflictDoNothing on (order_id, exchange, checksum) unique constraint |
| IMPT-10 | PARTIAL | Missing required fields ARE flagged. Unrecognized type strings stored as canonicalType=unknown but NOT surfaced in ImportSummary. CONTEXT.md required visibility. |
| IMPT-11 | SATISFIED | taxYear = parseInt(tradedAt.substring(0,4)) NOT NULL with index |
| TEST-02 | SATISFIED | 261 tests pass across 16 test files. Parser test files: spot-tx 356 lines, futures-tx 273, spot-order 304, futures-order 230, earn 223. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | Zero anti-patterns detected across all Phase 2 files |

No TODO, FIXME, placeholder, stub, or empty-return patterns found in any Phase 2 implementation file.

---

### Human Verification Required

#### 1. End-to-End Import Flow

**Test:** Start npm run dev, navigate to Transaktionen tab, drag raw-bitget-exports/2024-raw-bitget-exports/2024 Export spot transactions.csv onto the drop zone.
**Expected:** ~572 rows imported, sourceType badge shows Spot Tx, 0 duplicates, 0 errors.
**Why human:** Visual verification of drop zone appearance, progress spinner during upload, and ImportSummary glassmorphism render.

#### 2. Duplicate Detection UI

**Test:** Dismiss the ImportSummary, then drag the same 2024 spot CSV again.
**Expected:** 0 imported, 572 duplicates shown in ImportSummary. Note: ImportDropzone is hidden while ImportSummary is visible (ternary in App.tsx). User must dismiss before re-importing.
**Why human:** Verify the dismiss-then-reimport UX flow is acceptable. Confirm duplicate count renders correctly.

#### 3. All 5 Formats Import

**Test:** Import each fixture file from raw-bitget-exports/ directories. Verify sourceType badges in ImportSummary.
**Expected:** earn -> Earn, futures-tx -> Futures Tx, spot-order -> Spot Order, futures-order -> Futures Order, spot-tx 2025 comma -> Spot Tx.
**Why human:** Visual badge verification on real fixture data. Confirm no crashes on any format.

#### 4. Unknown Type Row Visibility (Gap Confirmation)

**Test:** Construct a spot_tx CSV with a row containing an unrecognized Type string (e.g., NewBitgetFeatureType). Import it.
**Expected by spec:** Row should appear as flagged/unmapped in ImportSummary.
**Actual current behavior:** Row is inserted with canonicalType=unknown. ImportSummary shows 1 imported, 0 errors. Row is not flagged.
**Why human:** This is the identified gap. Human judgment needed on whether to close it before Phase 2 is marked complete, or accept as known limitation given all 22 current Bitget type strings are mapped.

---

## Gaps Summary

One gap partially blocks Success Criterion 4 and IMPT-10:

**Unrecognized type strings are not visibly flagged in the ImportSummary.**

All 261 automated tests pass. The pipeline is fully functional for all known Bitget CSV formats. The gap is structural: PerFileResult lacks a flaggedCount field, the orchestrator does not count unknown-canonical-type rows, and ImportSummary has no UI element for them.

The practical impact is low: CANONICAL_TYPE_MAP covers all 22 known Bitget type strings including the risk_captital_user_transfer typo. Real imports from current Bitget exports will not encounter this path until Bitget introduces new type strings not yet in the map.

To close this gap, three targeted changes are required:
1. Add flaggedCount: number to PerFileResult in packages/shared/src/types/import.ts
2. In orchestrator.ts, count normalized rows where canonicalType === unknown and set flaggedCount
3. In ImportSummary.tsx, render a flagged/unmapped count badge when file.flaggedCount > 0

---

_Verified: 2026-03-22T08:55:34Z_
_Verifier: Claude (gsd-verifier)_
