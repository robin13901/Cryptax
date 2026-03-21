# Phase 2: CSV Import Pipeline - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Parse all 5 Bitget CSV export formats (spot transactions, futures transactions, spot order history, futures order history, on-chain earn), normalize into a unified transaction schema, deduplicate, and store in SQLite — with a user-facing import summary showing rows accepted, skipped, and flagged. No manual format selection — auto-detect by header signature.

</domain>

<decisions>
## Implementation Decisions

### Import UI interaction
- Drop zone AND a separate browse button — both available for initiating import
- Multi-file support: user can drop or select multiple CSV files at once, all parsed in one batch
- Real-time progress indicator during multi-file import (e.g., "Parsing file 2 of 5...")
- Import summary persists on screen until user explicitly dismisses it

### Import summary & error handling
- Combined totals at top (total imported / skipped / flagged), per-file breakdown expandable below
- Import summary stays visible until user dismisses it — no auto-dismiss

### Transaction type mapping
- Unknown Bitget type strings: import the row but flag it as 'unmapped' — store raw type as-is, mark for user review
- Unmapped rows are visible in the import summary so user knows they exist

### Multi-year & re-import behavior
- Tax year auto-detected from transaction timestamps — no manual year selection needed
- Per-batch undo: user can delete a specific import batch and re-import that file (not just additive-only, not full wipe)

### Claude's Discretion
- Where the import UI lives in the app (dedicated area, modal, or integrated into existing tab)
- Partial failure strategy: how to handle files with mix of valid/invalid rows (import good + flag bad vs. reject file)
- How flagged/problematic rows are surfaced to the user (inline in summary vs. separate view)
- How thorough the initial canonical_type mapping is (exhaustive upfront vs. known types + extend later)
- Whether to offer manual mapping UI for unknown types or handle in code
- Whether to preserve all raw CSV fields alongside normalized data (JSON blob for audit trail)
- Duplicate detection strategy (order ID only vs. order ID + content checksum for conflict detection)
- Import batch tracking implementation for the per-batch undo feature

</decisions>

<specifics>
## Specific Ideas

- 5 known CSV formats from Bitget with actual 2024 and 2025 exports available in `raw-bitget-exports/` for testing
- 2024 spot CSVs are semicolon-delimited with BOM prefix and tab-prefixed order IDs
- 2025 spot CSVs are comma-delimited — delimiter auto-detection is essential
- User expects to be able to import the same file multiple times without creating duplicate transactions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-csv-import-pipeline*
*Context gathered: 2026-03-21*
