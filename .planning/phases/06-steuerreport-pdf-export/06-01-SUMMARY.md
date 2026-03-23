---
phase: 06
plan: 01
name: ReportData Types + ReportGenerator
subsystem: report-engine
tags: [typescript, drizzle-orm, sqlite, tax-reporting, fifo, german-tax-law]

dependency-graph:
  requires:
    - "04-06: tax_summaries, lot_consumptions, futures_positions, earn_income, fifo_lots DB tables"
    - "04-08: in-memory SQLite test pattern"
    - "02: transactions table with exchange, tradedAt columns"
  provides:
    - "ReportData + sub-types in @cryptax/shared (report.ts)"
    - "ReportGenerator.generate(taxYear) → ReportData | null"
    - "Singleton reportGenerator for application use"
  affects:
    - "06-02: ReportRoute consumes ReportGenerator for JSON preview endpoint"
    - "06-03: PdfGenerator receives ReportData as input"
    - "06-04: CsvExporter receives ReportData as input"

tech-stack:
  added: []
  patterns:
    - "ReportGenerator takes Db in constructor (testable, application default injected)"
    - "Zero-valued summaries for missing buckets (defensive null safety)"
    - "freigrenzeStatus cliff check via parseFloat comparison at generator level"
    - "totalIncomeEur computed directly from earn_income (not tax_summaries.totalGainsEur)"

file-tracking:
  created:
    - packages/shared/src/types/report.ts
    - packages/backend/src/engine/report-generator.ts
    - packages/backend/src/engine/report-generator.test.ts
  modified:
    - packages/shared/src/index.ts

decisions:
  - id: "06-01-a"
    decision: "EarnSummary.totalIncomeEur sourced from SUM(earn_income.eur_value_at_receipt) — direct aggregation, not tax_summaries.totalGainsEur"
    rationale: "More explicit data lineage; both sources are identical in practice but direct query is self-documenting"
  - id: "06-01-b"
    decision: "freigrenzeStatus computed by ReportGenerator (not read from DB) — derived from netEur/totalIncomeEur at report time"
    rationale: "DB stores taxableAmountEur (result of cliff), but freigrenzeStatus is a display concern for the report layer; computing it here is clean"
  - id: "06-01-c"
    decision: "totalFeesEur in FuturesSummary sourced from futures_positions.fee_eur SUM — not from tax_summaries"
    rationale: "tax_summaries does not store a fee breakdown; futures_positions has the per-position fee data needed for the Anlage KAP display"
  - id: "06-01-d"
    decision: "EarnCoinBreakdown exported as named interface (not inline type in EarnSummary)"
    rationale: "Downstream PDF/CSV code will need to iterate perCoinBreakdown with type safety; named interface enables typed destructuring"
  - id: "06-01-e"
    decision: "TradeAppendix JOIN order: lot_consumptions → fifo_lots → transactions; sorted by transactions.tradedAt ASC then fifo_lots.symbol ASC"
    rationale: "Chronological sell order is most natural for Steuerberater review; symbol sub-sort ensures deterministic output for multi-coin sells"

metrics:
  tests-added: 22
  tests-total: 613
  duration: "7 min"
  completed: "2026-03-23"
---

# Phase 6 Plan 01: ReportData Types + ReportGenerator Summary

**One-liner:** ReportData type system (5 interfaces in @cryptax/shared) plus ReportGenerator class querying all 6 DB tables to produce a fully typed tax year report object.

## What Was Built

### @cryptax/shared — `packages/shared/src/types/report.ts`

Five new TypeScript interfaces forming the complete report data model:

- **ReportData** — top-level container with taxYear, generatedAt, and the three bucket summaries plus tradeAppendix
- **SpotSummary** — §23 EStG spot trades: gains/losses/net, taxableAmount, freigrenzeStatus ('under'|'over'), tradeCount, taxFreeTradeCount
- **FuturesSummary** — §20 EStG futures P&L: gains/losses/net, taxableAmount, totalFeesEur, estimatedTaxEur (26.375% Abgeltungssteuer)
- **EarnSummary** — §22 Nr. 3 EStG earn income: totalIncomeEur, freigrenzeStatus, recordCount, perCoinBreakdown[]
- **TradeAppendixRow** — one row per FIFO lot consumption: symbol, buyDate, sellDate, amounts, heldDays, haltefristMet, exchange

All monetary fields use `MoneyString` for lossless arithmetic. `EarnCoinBreakdown` extracted as a named interface for downstream type safety.

### @cryptax/backend — `packages/backend/src/engine/report-generator.ts`

**ReportGenerator class** with:
- Constructor accepts Drizzle `Db` instance (defaults to application DB; injectable for tests)
- `generate(taxYear: number): ReportData | null` — returns null when no `tax_summaries` rows exist for the year
- Private helpers: `buildSpotSummary`, `buildFuturesSummary`, `buildEarnSummary`, `buildTradeAppendix`
- Exported `reportGenerator` singleton for application use

**Key query patterns:**
- SpotSummary: `tax_summaries` WHERE bucket='private_sale' + `COUNT(DISTINCT sellTransactionId)` WHERE haltefristMet=1 for taxFreeTradeCount
- FuturesSummary: `tax_summaries` WHERE bucket='futures_pnl' + `SUM(feeEur)` from `futures_positions`
- EarnSummary: `tax_summaries` WHERE bucket='staking_earn' + `SUM(eurValueAtReceipt)` from `earn_income` + GROUP BY symbol for perCoinBreakdown
- TradeAppendix: `lot_consumptions` INNER JOIN `fifo_lots` INNER JOIN `transactions`, all rows, ORDER BY tradedAt ASC, symbol ASC

**Zero-value defaults:** All three bucket summaries return zero-valued structs when no DB row exists for that bucket — no null/undefined runtime errors.

### Tests — `packages/backend/src/engine/report-generator.test.ts`

22 tests across 8 scenarios:
1. Null returns for missing/wrong year
2. SpotSummary field mapping and freigrenzeStatus cliff
3. FuturesSummary Abgeltungssteuer and fee aggregation
4. EarnSummary per-coin breakdown and Freigrenze
5. TradeAppendix includes all rows (haltefrist-met + taxable)
6. TradeAppendix sort order (sellDate ASC, symbol ASC)
7. Missing buckets → zero-valued summaries (not null/undefined)
8. Mixed year with all three buckets + complete field mapping

Uses in-memory SQLite + full migrations pattern (identical to golden-master.test.ts). Seeds DB directly — no engine run required.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 06-01-a | EarnSummary.totalIncomeEur from SUM(earn_income) not tax_summaries | More explicit data lineage |
| 06-01-b | freigrenzeStatus computed at generate() time, not stored | Display concern; DB already has taxableAmountEur |
| 06-01-c | totalFeesEur from futures_positions.fee_eur SUM | tax_summaries has no fee breakdown column |
| 06-01-d | EarnCoinBreakdown as named interface | Typed destructuring in PDF/CSV consumers |
| 06-01-e | TradeAppendix sorted tradedAt ASC then symbol ASC | Natural chronological order for Steuerberater |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `npm run build -w packages/shared` — clean (0 errors)
- `npm run build -w packages/backend` — clean (0 errors)
- `npx vitest run packages/backend/src/engine/report-generator` — 22/22 tests pass
- Full project test suite — 613/613 tests pass

## Next Phase Readiness

**06-02 (ReportRoute — JSON preview endpoint)** can start immediately:
- Import `ReportGenerator` from `../engine/report-generator.js`
- Import `ReportData` type from `@cryptax/shared`
- Endpoint: `GET /api/report/:year` → call `reportGenerator.generate(year)`, return 200 with JSON or 404 if null
