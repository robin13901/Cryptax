# Phase 6: Steuerreport + PDF Export - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate a Finanzamt-ready tax report (PDF + CSV) from calculated tax data for any imported year. Contains Anlage SO summary (Spot §23), Anlage KAP summary (Futures §20), staking income summary (§22), and a full per-trade appendix. Report is previewed in the browser (Steuerreport tab) before downloading as PDF or CSV. Creating new tax calculation types or modifying the engine is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Report structure & sections
- Cover/title page: Yes — "Krypto-Steuerreport [Jahr]", generation date, disclaimer that this is no tax advice
- Section order: Claude's discretion (logical flow through tax buckets)
- Summary detail level: Compact — one page per bucket with key numbers (total gains, total taxable, Freigrenze status, estimated tax)
- Freigrenze display: Claude's discretion on how to present the cliff status prominently

### PDF visual style
- Visual tone: Branded / fintech — colored headers, accent lines, modern feel (not austere Finanzamt style)
- Language: German for section titles and legal terms, English for technical labels (coin names, order IDs)
- Page footer: Page number + generation date on every page (no branding in footer)
- Page format: A4 portrait throughout

### Trade appendix layout
- Columns: Claude's discretion — find the right balance for A4 portrait readability
- Grouping/sort: Claude's discretion — choose the most logical organization
- Scope: All trades including tax-free (Haltefrist met), clearly marked as such
- CSV export: Extended data dump — more columns than PDF for Steuerberater flexibility

### Browser preview experience
- Rendering: Claude's discretion (native HTML or embedded PDF)
- Navigation: Single scroll page — all sections in one continuous view
- Download buttons: Two separate buttons — "PDF herunterladen" and "CSV exportieren"
- Empty state: Helpful message + action link — "Keine Daten für [Jahr]. Bitte zuerst Transaktionen importieren und Steuerberechnung ausführen." with link to import

### Claude's Discretion
- Section order within the report
- Freigrenze status presentation style
- Preview rendering approach (native HTML vs embedded PDF)
- Trade appendix column selection and grouping strategy
- Font choice (TTF with Latin Extended for German characters)
- Color palette for fintech branding
- Loading states during PDF generation

</decisions>

<specifics>
## Specific Ideas

- Cover page with disclaimer is important — user wants it clear this is not official tax advice
- All trades in appendix, not just taxable — Steuerberater needs the full picture with Haltefrist-met trades clearly marked
- CSV should be a superset of PDF columns — Steuerberater may need raw data fields not shown in the PDF
- Two separate export buttons, not a dropdown — clear, direct actions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-steuerreport-pdf-export*
*Context gathered: 2026-03-23*
