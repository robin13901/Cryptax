# Roadmap: Cryptax

## Overview

Cryptax is built in 7 phases following a strict data dependency chain: foundation first, then data import, price enrichment, tax calculation, UI wiring, report export, and finally exchange API integration with security. Each phase delivers one complete, verifiable capability — no phase can run before its predecessor because the pipeline is linear. Testing is written alongside each phase's implementation, not deferred to a separate phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation + CI/CD** — Monorepo, SQLite schema, Hono server skeleton, CI pipeline, Decimal.js enforced from day one
- [x] **Phase 2: CSV Import Pipeline** — All 5 Bitget CSV formats parsed, normalized, stored; import UI operational
- [ ] **Phase 3: EUR Price Enrichment** — Historical EUR prices resolved and cached for all transactions
- [ ] **Phase 4: FIFO Engine + Tax Calculation** — Three-bucket German tax engine producing correct per-year tax summaries
- [ ] **Phase 5: Dashboard + Transaction UI** — Frontend wired to real data; all KPI cards, charts, and transaction list live
- [ ] **Phase 6: Steuerreport + PDF Export** — Finanzamt-ready tax report generated and exportable as PDF and CSV
- [ ] **Phase 7: Exchange API + Security** — Bitget API sync via ccxt, password protection, encrypted credential storage

---

## Phase Details

### Phase 1: Foundation + CI/CD

**Goal:** The project has a working monorepo structure, SQLite database with migrations, Hono API server, Decimal.js enforced as the monetary arithmetic standard, and a CI pipeline that gates all future changes with lint + test + build — so every subsequent phase is built on a validated foundation.

**Depends on:** Nothing (first phase)

**Requirements:** FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, FOUN-06, CICD-01, CICD-02, CICD-03, CICD-04, CICD-05, CICD-06, TEST-08

**Success Criteria:**
1. Running `npm run dev` starts both the Vite frontend and the Hono backend from a single command, and `GET /api/health` returns a 200 response.
2. The database schema migrates cleanly via `drizzle-kit migrate` with all tables created, all monetary columns typed as TEXT, and a `PRAGMA journal_mode = WAL` set on startup.
3. The Aurora background is replaced by Floating Lines from reactbits.dev across all three tabs with no visual regressions.
4. Pushing a PR triggers the GitHub Actions workflow (lint -> test -> build) and fails the PR if any step fails; 90% coverage threshold is enforced by Codecov on the PR diff.
5. The Claude Code Action posts an AI review comment on every PR, and branch protection prevents merging without passing CI.

**Plans:** 7 plans in 4 waves

Plans:
- [x] 01-01-PLAN.md — Monorepo scaffold (Wave 1)
- [x] 01-02-PLAN.md — Backend skeleton: Hono server + health endpoint + Vite proxy (Wave 2)
- [x] 01-03-PLAN.md — Database layer: Drizzle ORM + better-sqlite3 + STRICT + WAL (Wave 2)
- [x] 01-04-PLAN.md — Decimal.js + shared types in @cryptax/shared (Wave 2)
- [x] 01-05-PLAN.md — Floating Lines background replacing Aurora (Wave 2)
- [x] 01-06-PLAN.md — Vitest + coverage setup + initial tests (Wave 3)
- [x] 01-07-PLAN.md — CI/CD pipeline: GitHub Actions + Claude review + Codecov (Wave 4)

---

### Phase 2: CSV Import Pipeline

**Goal:** A user can drag and drop (or file-pick) any of the 5 Bitget CSV export formats and have all transactions correctly parsed, normalized into a unified schema, deduplicated, and stored in SQLite — with an import summary showing rows accepted, skipped, and flagged.

**Depends on:** Phase 1

**Requirements:** IMPT-01, IMPT-02, IMPT-03, IMPT-04, IMPT-05, IMPT-06, IMPT-07, IMPT-08, IMPT-09, IMPT-10, IMPT-11, TEST-02

**Success Criteria:**
1. Dropping a 2024 spot transactions CSV (semicolon-delimited, BOM-prefixed, tab-prefixed order IDs) and a 2025 spot transactions CSV (comma-delimited) both import successfully with zero dropped rows and all canonical types correctly assigned.
2. Importing the same CSV file twice skips all previously imported rows (duplicate detection by order ID + checksum) and shows a summary confirming the duplicate count.
3. All 5 Bitget CSV formats are auto-detected by header signature — no manual format selection required by the user.
4. Rows with missing or invalid critical fields (missing price, unrecognized type) are flagged in the import summary rather than silently dropped or crashing the import.
5. Transactions from 2024 and 2025 CSVs are tagged with their correct tax year and appear separately filterable in the database.

**Plans:** 8 plans in 4 waves

Plans:
- [x] 02-01-PLAN.md — CSV parsing infrastructure: schema migration, csv-parse install, shared types (Wave 1)
- [x] 02-02-PLAN.md — Spot transactions parser with TDD (Wave 2)
- [x] 02-03-PLAN.md — Futures transactions parser with TDD (Wave 2)
- [x] 02-04-PLAN.md — Spot order history parser with TDD (Wave 2)
- [x] 02-05-PLAN.md — Futures order history parser with TDD (Wave 2)
- [x] 02-06-PLAN.md — On-chain earn parser with TDD (Wave 2)
- [x] 02-07-PLAN.md — Format detector + canonical type map + normalizer (Wave 3)
- [x] 02-08-PLAN.md — Import API + UI: insert layer, orchestrator, routes, drag & drop (Wave 4)

---

### Phase 3: EUR Price Enrichment

**Goal:** Every imported transaction has a EUR price resolved at its exact trade timestamp — fetched from Bitget's public candle API with CoinGecko as fallback, cached in SQLite so it is never fetched twice, and respecting Europe/Berlin timezone for all timestamp conversions.

**Depends on:** Phase 2

**Requirements:** PRCE-01, PRCE-02, PRCE-03, PRCE-04, PRCE-05, PRCE-06, PRCE-07, TEST-04

**Success Criteria:**
1. After triggering price enrichment, all transactions with a direct COIN/EUR Bitget market have their EUR price populated from the Bitget candle API using the 1-minute candle closest to the trade timestamp.
2. Transactions for coins without a direct EUR pair fall back to COIN/USDT x USDT/EUR conversion at the same timestamp, with the fallback path visible in the price_cache record.
3. Transactions for coins not listed on Bitget (delisted or obscure tokens) fall back to CoinGecko's historical price API without blocking enrichment of other transactions.
4. Re-running price enrichment for already-resolved transactions completes instantly (cache hit, no API calls); the price resolution status UI shows which transactions still have NULL prices.
5. All timestamp conversions correctly handle Europe/Berlin DST boundaries — a trade at 2024-03-31 02:30 (spring-forward night) resolves to the correct UTC timestamp.

**Plans:** 5 plans in 4 waves

Plans:
- [ ] 03-01-PLAN.md — Schema migration + deps + timezone/symbol utils (Wave 1)
- [ ] 03-02-PLAN.md — Bitget candle client + price cache layer (Wave 2)
- [ ] 03-03-PLAN.md — CoinGecko fallback client (Wave 2)
- [ ] 03-04-PLAN.md — Resolution strategy + enrichment engine (Wave 3)
- [ ] 03-05-PLAN.md — Price enrichment API + UI + integration (Wave 4)

---

### Phase 4: FIFO Engine + Tax Calculation

**Goal:** Running the tax engine produces correct, Finanzamt-compliant tax summaries for every imported year — with FIFO lot tracking per coin, Haltefrist applied correctly, three tax buckets kept strictly separate, and the Freigrenze implemented as a cliff (not a deduction).

**Depends on:** Phase 3

**Requirements:** TAXC-01, TAXC-02, TAXC-03, TAXC-04, TAXC-05, TAXC-06, TAXC-07, TAXC-08, TAXC-09, TAXC-10, TAXC-11, TEST-01, TEST-03

**Success Criteria:**
1. A hand-verified scenario of 3 BTC buys at known prices, 1 partial sell crossing two lots, with one lot held more than 365 days — produces the correct taxable gain (zero for the Haltefrist-met lot, correct partial gain for the recent lot) matching the expected result.
2. Futures P&L rows are never included in the FIFO lot pool — running the engine on a dataset with both spot and futures transactions produces separate Spot (§23) and Futures (§20) summaries with no cross-contamination.
3. Gains of 999.99 EUR produce 0 EUR taxable (Freigrenze not exceeded); gains of 1,000.01 EUR produce 1,000.01 EUR taxable (entire amount, cliff behavior confirmed).
4. The engine refuses to run (returns an error) if any transaction has a NULL EUR price, and the error message identifies which transactions are missing prices.
5. Truncating derived tables and rerunning the engine on the same transaction set produces byte-identical tax summaries both times (stateless re-runnable idempotency).

**Estimated Plans:** 8

Plans:
- [ ] 04-01: FIFO lot engine core — FifoEngine class; lot creation on buy (asset-isolated); lot consumption on sell with `lot.remaining` (not `original_amount`); partial lot splitting (TAXC-01, TAXC-02)
- [ ] 04-02: Haltefrist + spot tax calculator — per-lot >=365-day calculation; §23 EStG tax-free vs. taxable split; Freigrenze cliff at 1.000 EUR; fee deduction as Werbungskosten (TAXC-03, TAXC-04, TAXC-07)
- [ ] 04-03: Futures P&L engine — FuturesPnlEngine; aggregate signed realized P&L per position; Abgeltungssteuer 26.375% on all realized gains; no Haltefrist, no Freigrenze; strict isolation from FIFO (TAXC-05)
- [ ] 04-04: Earn income engine — EarnIncomeEngine; §22 Nr. 3 EStG income at EUR value at Zufluss timestamp; 256 EUR Freigrenze cliff; new FIFO lots created for received coins (TAXC-06)
- [ ] 04-05: Tax bucket isolation + orchestrator — TaxCalculator orchestrating all three engines; §23/§20/§22 buckets never mixed; cross-year FIFO lot continuity (2024 lots feed 2025 disposals) (TAXC-08, TAXC-09)
- [ ] 04-06: Engine API + stateless re-run — POST /api/engine/run; truncate derived tables and recompute from transactions; NULL price gate (TAXC-10, TAXC-11)
- [ ] 04-07: FIFO engine unit tests — golden master tests for known tax scenarios; Freigrenze boundary tests (999.99, 1000.00, 1000.01); Haltefrist boundary tests (364, 365, 366 days); fee deduction tests (TEST-01, TEST-03)
- [ ] 04-08: Property-based FIFO tests — fast-check property testing for FIFO invariants: lot.remaining never negative, total consumed never exceeds total acquired per asset, bucket totals are additive across years

---

### Phase 5: Dashboard + Transaction UI

**Goal:** The Dashboard and Transaktionen tabs show live data from the database — KPI cards with real calculated numbers, all six Recharts visualizations rendering correctly, a year selector that updates all charts, and a transaction list that is filterable, searchable, and sortable.

**Depends on:** Phase 4

**Requirements:** DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, TRAN-01, TRAN-02, TRAN-03, TRAN-04, TRAN-05, TRAN-06, TEST-05

**Success Criteria:**
1. Selecting a tax year on the Dashboard updates all four KPI cards (Gesamtgewinn, Anzahl Trades, steuerpflichtiger Betrag, geschaetzte Steuer) with real calculated values — no placeholder text visible anywhere.
2. All six charts render with real data: P&L over time (line), portfolio distribution (donut), gain/loss per coin (bar), monthly performance (bar), spot vs futures comparison (grouped bar), and year-over-year comparison — each chart responds to the year selector.
3. The Transaktionen tab lists all imported transactions with correct category badges (Spot, Futures, Earn, Fee); filtering by type + coin + date range reduces the list correctly; searching by coin name or order ID works.
4. Clicking a transaction opens a detail view showing full row data, associated FIFO lots consumed, and the tax impact of that specific trade.
5. The Freigrenze progress indicator correctly shows proximity to the 1.000 EUR cliff with color-coded warning states (green/amber/red).

**Estimated Plans:** 7

Plans:
- [ ] 05-01: Summary API — GET /api/summary/:year returning KPI data (total gain, trade count, taxable amount, estimated tax, Freigrenze status per bucket)
- [ ] 05-02: Dashboard KPI cards + year selector — wire DASH-01, DASH-07 to API; year selector updates all components; Freigrenze progress indicator
- [ ] 05-03: P&L + monthly performance charts — DASH-02 (line chart P&L over time), DASH-05 (bar chart monthly realized gains); wire to real API data
- [ ] 05-04: Portfolio + per-coin charts — DASH-03 (donut chart portfolio distribution), DASH-04 (bar chart per-coin gain/loss)
- [ ] 05-05: Spot vs futures + year-over-year charts — DASH-06 (grouped bar spot vs futures), DASH-08 (year-over-year comparison)
- [ ] 05-06: Transaction list API + UI — GET /api/transactions (paginated, filterable by type/coin/date, searchable, sortable); TRAN-01 through TRAN-05; category badges
- [ ] 05-07: Transaction detail view + component tests — TRAN-06 detail view with FIFO lot association and tax impact; React component tests with Testing Library for all new components (TEST-05)

---

### Phase 6: Steuerreport + PDF Export

**Goal:** A user can select any imported tax year and generate a Finanzamt-ready PDF Steuerreport — containing the Anlage SO summary, Anlage KAP summary, staking income summary, and a full per-trade appendix — plus a CSV export for their Steuerberater; all previewed in the browser before downloading.

**Depends on:** Phase 5

**Requirements:** REPT-01, REPT-02, REPT-03, REPT-04, REPT-05, REPT-06, REPT-07, REPT-08, TEST-06, TEST-07

**Success Criteria:**
1. Clicking "Report generieren" for a selected year displays a preview in the browser containing Anlage SO summary (total taxable spot gains, Freigrenze status, transaction count), Anlage KAP summary (futures gains, Abgeltungssteuer amount), and staking income summary.
2. The full trade appendix lists every taxable transaction with: coin, buy date, sell date, cost basis in EUR, proceeds in EUR, gain/loss, Haltefrist status (met/not met) — and paginates correctly for 50, 100, and 200+ rows.
3. Downloading the PDF produces a valid PDF file with correct German Umlauts (ae oe ue ss EUR), an embedded TTF font, and formatting consistent with Finanzamt document expectations.
4. Downloading the CSV export produces a machine-readable file with all taxable transactions, suitable for import by a Steuerberater.
5. The full import -> price enrichment -> tax calculation -> report generation flow completes without errors in a Playwright E2E test using the actual 2024 and 2025 Bitget CSV test fixtures.

**Estimated Plans:** 7

Plans:
- [ ] 06-01: Report generator service — ReportGenerator class; aggregate tax_summaries + lot_consumptions + futures_positions + earn_income into report data model (REPT-01, REPT-02, REPT-03, REPT-04)
- [ ] 06-02: PDF generation — PDFKit 0.18.0; embed TTF font with Latin Extended for German characters; Anlage SO + KAP + Staking income sections (REPT-05)
- [ ] 06-03: PDF trade appendix — per-trade table with PDFKit's native table API; test pagination at 50/100/200 rows; fallback to coordinate layout if table API has edge case (REPT-04 continued)
- [ ] 06-04: CSV export — machine-readable CSV of all taxable transactions; column mapping for Steuerberater compatibility (REPT-06)
- [ ] 06-05: Report API + year selection — GET /api/report/:year/preview (JSON), GET /api/report/:year/pdf, GET /api/report/:year/csv; year selection UI (REPT-07, REPT-08)
- [ ] 06-06: Report preview UI — browser preview in Steuerreport tab; section navigation; download buttons
- [ ] 06-07: Integration + E2E tests — integration tests for full API flow (import -> calculate -> report) (TEST-06); Playwright E2E test for complete user journey: drag CSV -> enrich prices -> run engine -> view dashboard -> export PDF (TEST-07)

---

### Phase 7: Exchange API + Security

**Goal:** The application is protected by a password login screen, exchange API credentials are encrypted at rest, and the user can connect their Bitget account to pull new trade history directly without exporting CSVs.

**Depends on:** Phase 6

**Requirements:** EXCH-01, EXCH-02, EXCH-03, EXCH-04, EXCH-05, SECU-01, SECU-02, SECU-03, SECU-04

**Success Criteria:**
1. Navigating to the app without authentication redirects to a password login screen; entering the correct password grants access; entering an incorrect password shows an error and denies access.
2. Exchange API credentials (key + secret) entered via the connection management UI are stored encrypted on disk (AES-256-GCM + PBKDF2) and cannot be read from the SQLite file or logs in plaintext.
3. Triggering a manual sync pulls new spot and futures trades from Bitget via ccxt since the last sync timestamp, normalizes them through the existing import pipeline, and shows a sync summary.
4. Incremental sync correctly skips trades already imported — running sync twice with no new trades on Bitget results in zero new rows.
5. No credentials appear in application logs, console output, error messages, or git-tracked files at any point during setup or sync.

**Estimated Plans:** 7

Plans:
- [ ] 07-01: Authentication system — single-user password hash (bcrypt); login screen component; session token (JWT or signed cookie); protected route middleware on all API endpoints (SECU-01)
- [ ] 07-02: Credential encryption — AES-256-GCM encryption using node:crypto; PBKDF2 key derivation from user password; credential store in SQLite (TEXT blob); decrypt only in memory (SECU-02, SECU-03)
- [ ] 07-03: Security hardening — audit all log statements for credential leakage; `.gitignore` for any credential-adjacent files; no-credentials rule in CLAUDE.md (SECU-04)
- [ ] 07-04: ccxt Bitget spot adapter — ccxt 4.5.44 BitgetAdapter implementing ExchangeAdapter interface; pull spot trade history; normalize via existing import pipeline (EXCH-01)
- [ ] 07-05: ccxt Bitget futures adapter — pull futures trade history; normalize via existing import pipeline; handle deep history pagination (EXCH-02)
- [ ] 07-06: Exchange management UI — add/edit/delete exchange connections; credential entry form; connection status indicator (EXCH-03)
- [ ] 07-07: Sync engine — POST /api/exchanges/:id/sync; manual sync trigger; incremental sync (last_sync_at watermark); sync progress UI (EXCH-04, EXCH-05)

---

## Progress

**Execution Order:** Phases execute sequentially 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 (strict data dependency chain).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + CI/CD | 7/7 | Complete | 2026-03-21 |
| 2. CSV Import Pipeline | 8/8 | Complete | 2026-03-22 |
| 3. EUR Price Enrichment | 0/5 | Planned | - |
| 4. FIFO Engine + Tax Calculation | 0/8 | Not started | - |
| 5. Dashboard + Transaction UI | 0/7 | Not started | - |
| 6. Steuerreport + PDF Export | 0/7 | Not started | - |
| 7. Exchange API + Security | 0/7 | Not started | - |

**Total plans:** 49 across 7 phases
