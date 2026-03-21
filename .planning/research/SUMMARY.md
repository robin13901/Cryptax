# Project Research Summary

**Project:** Cryptax — Local German Crypto Tax Reporting Tool
**Domain:** Personal finance / crypto taxation / German EStG compliance
**Researched:** 2026-03-21
**Confidence:** HIGH (stack + architecture + pitfalls), MEDIUM (German tax law specifics)

---

## Executive Summary

Cryptax is a single-user, localhost-only crypto tax reporting tool for German tax law. The existing codebase is a React 19 + Vite 8 + TypeScript 5.9 frontend (glassmorphism dashboard) that currently shows placeholder data. The backend does not yet exist. Research across five dimensions confirms a clear, well-understood architecture: a Node.js + Hono backend, SQLite database with Drizzle ORM, a pipeline-based data flow (CSV import → price enrichment → FIFO engine → report), and a strict separation between the three German tax regimes (§23 EStG spot gains, §20 EStG futures Abgeltungssteuer, §22 Nr. 3 EStG staking income). This is a brownfield addition, not a greenfield project — the frontend must not be touched.

The recommended approach is a 6-phase build order that follows strict data dependencies: foundation first, then CSV import, price enrichment, FIFO engine, dashboard wiring, and PDF export — in that order without shortcuts. The FIFO engine is the technical core of the tool and cannot run until EUR prices are resolved for all transactions; price enrichment cannot run until transactions are imported. This linear dependency chain is the single most important architectural constraint. The Bitget CSV files have been directly inspected and contain 30 documented domain-specific pitfalls — several of which (tab-prefixed IDs, BOM characters, delimiter change between 2024 and 2025, `Financial` type sign semantics) are high-severity bugs that would silently produce wrong tax numbers if not handled.

The primary risks are (1) floating-point arithmetic in monetary calculations — must use Decimal.js from day one, (2) the Freigrenze cliff being implemented as a Freibetrag deduction (the difference between a user paying 0 EUR tax vs. 1,001 EUR tax at 1,001 EUR gains), and (3) incomplete CSV parsing that silently drops taxable events like crypto-to-crypto swaps and staking income spread across non-earn CSV files. All three risks have clear prevention strategies. German tax law specifics (Haltefrist duration, Freigrenze amounts, futures classification under §20 vs. §23) are MEDIUM confidence based on cross-referenced training data and third-party tax guides — a Steuerberater review of the generated report is recommended before actual tax filing.

---

## Key Findings

### 1. Recommended Stack

The existing frontend (React 19, Vite 8, TypeScript 5.9, Recharts 3.8.0, motion/react) is installed and must not be changed. All new work is backend-only until Phase 5 when the frontend is wired to real data.

For the backend, Hono 4.12.8 with `@hono/node-server` is the correct choice over Express (legacy, no native TypeScript) or Fastify (excessive boilerplate for a single-user tool). It serves both the API and the Vite-built frontend from a single process. better-sqlite3 12.8.0 (synchronous driver, battle-tested) paired with Drizzle ORM 0.45.1 (type-safe schema + migrations) is the database layer. All monetary values must be stored as TEXT strings in SQLite and computed using Decimal.js — never native JavaScript `number`.

For CSV parsing, `csv-parse` 6.2.1 handles the mixed-delimiter, BOM-prefixed Bitget exports. PDFKit 0.18.0 handles PDF report generation with its new (0.17.0+) native table API, but requires an embedded TTF font for German Umlauts. Historical EUR price resolution uses the Bitget public candle API as primary (no auth required, 1-minute granularity, same exchange as the trades) with CoinGecko as fallback for delisted tokens. The testing stack is Vitest 4.1.0 (unit + integration), @testing-library/react 16.3.2 (component tests), and Playwright 1.58.2 (E2E).

**Core technologies:**
- **Hono 4.12.8** — HTTP server — TypeScript-first, zero dependencies, serves frontend + API from single process
- **better-sqlite3 12.8.0** — SQLite driver — synchronous, native, wraps SQLite 3.51.3
- **Drizzle ORM 0.45.1 + drizzle-kit 0.31.10** — ORM + migrations — type-safe schema, prevents SQL injection
- **Decimal.js** — monetary arithmetic — mandatory to avoid IEEE 754 float errors in tax calculations
- **csv-parse 6.2.1** — CSV parsing — handles BOM, mixed delimiters, custom column mapping per format
- **PDFKit 0.18.0** — PDF generation — native table support (new in 0.17.0), requires TTF font for German characters
- **Bitget public API** (primary) + CoinGecko (fallback) — historical EUR prices — no auth required for Bitget
- **p-throttle** — API rate limiting — 10 req/s max to respect Bitget's 20 req/s limit with headroom
- **Vitest 4.1.0** — test runner — workspace support for frontend (jsdom) and backend (node) in one config
- **Playwright 1.58.2** — E2E tests — full import→calculation→report flow

Full details: `.planning/research/STACK.md`

---

### 2. Feature Landscape

German tax law defines the non-negotiable constraints. The three tax regimes that must be tracked separately:
- **§23 EStG** — Spot gains/losses, progressive income rate, 1-year Haltefrist (gains tax-free if held >365 days), 1.000 EUR Freigrenze cliff
- **§20 EStG** — Futures/derivatives, flat 26.375% Abgeltungssteuer, no Haltefrist, no Freigrenze
- **§22 Nr. 3 EStG** — Staking/earn income, personal income rate at time of receipt (Zufluss), 256 EUR Freigrenze cliff

**Must have (table stakes — MVP blockers):**
- CSV import for all 5 Bitget export formats (spot_tx, futures_tx, spot_orders, futures_orders, earn)
- EUR price resolution at transaction timestamp (Bitget API + SQLite cache + CoinGecko fallback)
- FIFO engine with lot tracking, partial lot consumption, cross-year lot continuity
- Three-bucket tax calculation: Spot (§23), Futures (§20), Earn (§22)
- Transaction list with category labels and year filter
- Dashboard KPIs (Gesamtgewinn, Steuerpflichtiger Betrag, estimated Steuer, trade count)
- Steuerreport — Anlage SO summary + per-trade appendix
- PDF export of the Steuerreport

**Should have (differentiators — Phase 2):**
- Multi-year cross-FIFO continuity (2024 lots feeding into 2025 disposals)
- Haltefrist countdown visualization (which held positions become tax-free and when)
- Freigrenze progress indicator (progress bar toward 1.000 EUR cliff with warning states)
- Full Recharts dashboard (P&L over time, portfolio composition, per-coin P&L, waterfall)
- CSV export for tax advisors / WISO Steuer
- Import audit trail (per-file log with row counts, errors, unknown types)

**Defer to Phase 3+:**
- Marginal rate input for estimated Spot tax
- WISO-specific CSV column mapping
- Manual transaction category override
- Per-coin P&L drill-down view

**Anti-features (explicitly out of scope):**
- Real-time price feeds (this is a tax tool, not a portfolio tracker)
- Multiple exchange support beyond Bitget CSV (each exchange is a separate product)
- ELSTER direct submission (requires ERIC certificate + extensive integration)
- LIFO/AVCO cost basis methods (German law requires FIFO)
- Cloud deployment / multi-user (local file = local trust)

Full details: `.planning/research/FEATURES.md`

---

### 3. Architecture Overview

The architecture is a **monorepo with npm workspaces** containing three packages: `frontend` (existing dashboard), `backend` (new), and `shared` (TypeScript interfaces). The frontend communicates exclusively via `/api/*` HTTP JSON — no engine logic, no SQLite access in the frontend. Vite's `server.proxy` handles dev routing; the backend serves the Vite `dist/` as static files in production.

The data flow is a **6-stage pipeline** with no shortcuts or out-of-order execution:

```
CSV File → Format Detection → Raw Storage → Normalization → Price Enrichment → FIFO Engine → Report
```

Each stage has exactly one upstream dependency. The FIFO engine operates on a **clean-slate, re-runnable model**: every recalculation truncates the derived tables (fifo_lots, lot_consumptions, futures_positions, earn_income, tax_summaries) and rebuilds from the `transactions` table. This makes the engine idempotent and safe to rerun after bug fixes.

The **SQLite schema** has three critical design choices: (1) all monetary columns as TEXT (not REAL), (2) a separate `raw_rows` table for audit trail with SHA256 checksum on import to prevent duplicates, and (3) three independent derived table sets for the three tax regimes — `fifo_lots`/`lot_consumptions` for §23 spot, `futures_positions`/`futures_fees` for §20, and `earn_income` for §22.

**Major components:**

| Component | Package | Responsibility |
|-----------|---------|----------------|
| 5 CSV Parsers | backend/services/parsers/ | Format-specific parsing, BOM strip, tab trim, canonical_type mapping |
| FormatDetector | backend/services/ | Detect which of 5 formats from column headers + delimiter |
| PriceEnricher | backend/services/ | Cache-first EUR price lookup via Bitget API + CoinGecko fallback |
| BitgetPriceClient | backend/services/ | Port of Python reference script, COINEUR and COINUSDT×USDTEUR strategies |
| FifoEngine | backend/engine/fifo/ | FIFO lot creation, partial consumption, Haltefrist calculation |
| FuturesPnlEngine | backend/engine/futures/ | Aggregate signed P&L per position, separate from FIFO |
| EarnIncomeEngine | backend/engine/earn/ | §22 income at Zufluss, creates new FIFO lots for received coins |
| TaxCalculator | backend/engine/ | Orchestrates all engines, writes tax_summaries, enforces Freigrenze cliff |
| ReportGenerator | backend/services/ | Builds Anlage SO + trade appendix from tax_summaries + lot_consumptions |
| ExchangeAdapter interface | shared/types/ | Thin adapter pattern; BitgetAdapter implements it; ccxt deferred |

Full details: `.planning/research/ARCHITECTURE.md`

---

### 4. Critical Pitfalls

30 domain-specific pitfalls were identified from direct inspection of the actual Bitget CSV files. The top 10 most impactful:

**CRITICAL severity (wrong tax numbers / data corruption):**

1. **Floating-point arithmetic (C1)** — Using JavaScript `number` for any monetary calculation causes errors that accumulate across 3,400+ transactions. Prevention: Decimal.js for all computation, TEXT storage in SQLite, no `REAL` columns anywhere. Must be enforced from Phase 1 — retrofitting is painful.

2. **Freigrenze implemented as Freibetrag deduction (C5)** — The 1.000 EUR Freigrenze is a cliff, not an allowance: gains of 999 EUR → 0 EUR taxable; gains of 1.001 EUR → 1.001 EUR taxable (entire amount). Implementing `taxable = max(0, gains - 1000)` is wrong. Prevention: `if (totalGains.gt(1000)) return totalGains; return ZERO` with explicit boundary tests at 999.99, 1000.00, and 1000.01.

3. **Futures P&L mixed into FIFO lot system (C3)** — The 1,814 `contract_main_settle_fee` rows in the 2025 futures file look like buy/sell transactions but are Abgeltungssteuer events under §20 EStG, not §23. Including them in the FIFO engine corrupts the USDT lot pool and double-counts gains. Prevention: strict `canonical_type` allowlist for FIFO — futures types never touch `fifo_lots`.

4. **FIFO lot pool not isolated per asset (C2)** — Missing `WHERE asset = ?` in the FIFO query causes BTC disposals to consume USDE or SOL lots. Prevention: every FIFO query must include the asset filter; test with two different coins simultaneously.

5. **Partial lot consumption uses original_amount instead of remaining (C4)** — `Math.min(lot.original_amount, remainingToDispose)` instead of `Math.min(lot.remaining, remainingToDispose)` causes lots to go negative or disposals to stop early. Prevention: always query `lot.remaining`; add `CHECK (remaining >= 0)` constraint; unit test with 1.5 BTC sold across two lots.

6. **Haltefrist timezone bug (C6)** — Bitget CSV timestamps are Europe/Berlin, not UTC. `new Date('2024-12-31 17:00:05')` interpreted as UTC is 1 hour off, shifting the day boundary for holding period calculations. Prevention: parse all Bitget timestamps as `Europe/Berlin` using `date-fns-tz`, store UTC-normalized strings; test the 23:59 → 00:01 edge case.

**HIGH severity (incorrect behavior / missing taxable events):**

7. **Tab prefix on order IDs not stripped (H1)** — Every data row in all 5 Bitget CSV formats has a `\t` character before the ID. Unstirpped IDs break duplicate detection. Prevention: `external_id = row.orderId.trim()` in every parser — confirmed by direct hex inspection.

8. **BOM character corrupting first column header (H2)** — All Bitget CSVs have `\xEF\xBB\xBF` as the first three bytes. Without `bom: true` in csv-parse, format detection fails. Prevention: pass `bom: true` option; strip before delimiter detection.

9. **2024/2025 spot delimiter change (H3)** — The 2024 spot export uses semicolons; the 2025 spot export uses commas for identical column structure. A hardcoded semicolon parser silently imports zero 2025 rows with no error. Prevention: auto-detect delimiter by trying semicolon parse first; if only 1 column results, switch to comma.

10. **Crypto-to-crypto swap not modeled as taxable event (H5)** — Bitget records swaps as `Exchange spending` (disposal) + `Exchange income` (acquisition) at the same timestamp. Missing the spending row means gains on swapped coins go unreported. Prevention: `swap_out` canonical type triggers FIFO lot consumption; pair with `swap_in` for the acquisition cost basis.

Full details with prevention strategies, warning signs, and phase warnings: `.planning/research/PITFALLS.md`

---

### 5. CI/CD and AI Workflow

The recommended pipeline is a **4-job GitHub Actions workflow**:

```
lint (fast feedback) → test (Vitest + coverage upload to Codecov) → e2e (Playwright, on push to main or 'run-e2e' label) → build (depends on lint + test)
```

Node.js 22 LTS is used in CI (not 23 which is the development version). `better-sqlite3` compiles cleanly on `ubuntu-latest` without extra apt steps — the runner ships `build-essential` and Python 3. Cache keys must include OS + Node version + lockfile hash to avoid cross-platform native binary conflicts.

For AI code review, `anthropics/claude-code-action@v1` is recommended over the managed service (Teams/Enterprise only). Configure it on `pull_request` events with a domain-specific prompt covering FIFO logic correctness, Haltefrist calculations, Freigrenze boundaries, and TypeScript type safety. Create a `CLAUDE.md` at the project root with Cryptax domain context (tax regimes, critical correctness areas, code standards) to guide all Claude sessions including CI reviews.

Codecov.io provides coverage tracking with separate flags for `dashboard` and `server` packages, 90% line/function/statement thresholds, 85% branch threshold, and patch coverage gating at 85% for PR changes. Use `@vitest/coverage-v8` (not Istanbul) for speed and accuracy.

**CI implementation order:** Vitest config with coverage → ci.yml (lint + test + build) → Codecov setup → Claude review workflow → CLAUDE.md → automation workflows (labeler, stale, release-drafter) → branch protection rules.

Full details: `.planning/research/CICD-AI-WORKFLOW.md`

---

### 6. Open Questions

These items were not fully resolved by research and require attention during planning or implementation:

| Question | Confidence | How to Handle |
|----------|-----------|---------------|
| Exact German tax law: is Haltefrist ≥365 days or >365 days? | MEDIUM | Use ≥365 (inclusive) as mainstream interpretation; add disclaimer in report; verify with Steuerberater |
| Does the 10-year Haltefrist apply to staked crypto? | LOW | Implement 1-year (mainstream tools: Koinly, Blockpit, CoinTracking all use 1-year); add prominent disclaimer |
| WISO Steuer CSV import column spec | UNKNOWN | Research during Phase 3 planning; Blockpit confirms compatibility exists but spec not documented |
| PDFKit table pagination behavior at 50-200 rows | MEDIUM | Test in Phase 6 implementation; have fallback to manual coordinate-based layout if table API fails |
| CoinGecko free tier sufficiency for initial bulk load | MEDIUM | Cache Bitget prices first; CoinGecko is fallback only for delisted tokens (likely <20 coins) — rate limits should not be a problem |
| `Gains` and `Consumption` transaction types in 2025 spot | HIGH | Confirmed in actual data but exact tax treatment (earn product settlement) needs mapping to canonical type before Phase 2 |
| Whether `Position profit` rows are USDE earn yield or something else | HIGH | Confirmed as earn yield from USDE FlexEarn; classify as `earn_yield` under §22 Nr. 3 EStG |

---

## Implications for Roadmap

The build order is dictated by strict data dependencies: you cannot tax what you have not imported; you cannot FIFO what you have not priced; you cannot report what you have not calculated.

### Phase 1: Foundation (Monorepo + Database + Server Skeleton)
**Rationale:** Everything downstream depends on having a working server, SQLite schema, and Decimal.js established as the monetary arithmetic standard from day one.
**Delivers:** npm workspaces monorepo, SQLite schema with all tables, Hono server skeleton, health check endpoint, Vitest + CI pipeline setup.
**Addresses:** Foundation for all features.
**Avoids:** C1 (Decimal.js from day one), M3 (WAL mode enabled on startup), L1 (Drizzle migrations workflow), L2 (STRICT mode on SQLite tables), L3 (Vitest pool: 'forks' for better-sqlite3).
**Research flag:** No additional research needed — well-documented patterns with verified versions.

### Phase 2: CSV Import Pipeline (All 5 Bitget Formats)
**Rationale:** Without imported data, nothing else can run. The 5 parsers are independent of each other and can be built in parallel. Must handle all documented edge cases or Phase 3 receives corrupted input.
**Delivers:** POST /api/import endpoint, 5 format-specific parsers, format auto-detection, BOM strip, tab trim, duplicate detection via checksum + external_id, import feedback UI.
**Addresses:** CSV import (table stakes #1), Transaction list view (table stakes #5), Import audit trail (differentiator D5).
**Avoids:** H1 (tab prefix), H2 (BOM), H3 (delimiter change), H4 (unknown types flagged not dropped), H6 (Financial sign semantics), M2 (row-level deduplication), M6 (Interest rows in spot CSV counted as earn income).
**Research flag:** The complete canonical_type mapping for all Bitget transaction types (especially `Gains`, `Consumption`, `Position profit`) should be validated against actual CSV data during implementation. The mapping table in PITFALLS.md H4 is the starting reference.

### Phase 3: EUR Price Enrichment
**Rationale:** The FIFO engine requires EUR prices on all transactions before it can run. Price enrichment is a separate phase because it involves external API calls with rate limiting, caching, and fallback logic — it should be validated independently before the engine runs on top of it.
**Delivers:** BitgetPriceClient (port of Python reference script), price_cache table, cache-first lookup, COINEUR + COINUSDT×USDTEUR strategy, CoinGecko fallback, enrichment progress endpoint, UI warning for unresolved prices, manual override capability.
**Addresses:** EUR price resolution (table stakes #2).
**Avoids:** H7 (Europe/Berlin timestamp parsing), H8 (missing prices block engine run), M1 (USDT→EUR same timestamp), M5 (rate limiting via p-throttle at 10 req/s).
**Research flag:** Verify `date-fns-tz` `zonedTimeToUtc` behavior for DST boundary dates (last Sunday of March and October in Germany) during implementation.

### Phase 4: FIFO Engine + Tax Calculation
**Rationale:** The computational core of the tool. Must be built with meticulous precision: Decimal.js everywhere, per-coin lot isolation, partial lot arithmetic, separate engines for three tax regimes. This is the highest-risk phase — a bug here produces wrong tax numbers.
**Delivers:** FifoEngine (lots + consumptions), FuturesPnlEngine (signed P&L aggregation), EarnIncomeEngine (§22 income at Zufluss), TaxCalculator orchestrator, tax_summaries materialization, POST /api/engine/run endpoint.
**Addresses:** FIFO engine (table stakes #3), German tax calculation three buckets (table stakes #4), cross-year FIFO continuity (differentiator D1).
**Avoids:** C1 (Decimal.js for all arithmetic), C2 (per-coin lot isolation), C3 (futures never enter FIFO), C4 (lot.remaining not lot.original_amount), C5 (Freigrenze cliff with boundary tests), C6 (UTC-only date arithmetic), H5 (swap_out triggers FIFO disposal), H9 (negative balance as data gap, not crash), M7 (signed funding fee amounts), M10 (1-year not 10-year Haltefrist).
**Research flag:** Deeply research partial lot arithmetic edge cases and property-based testing with fast-check for FIFO invariants during phase planning. Also validate the §22 vs §23 treatment of USDE interest (it is classified as earn income, not spot gain — confirm this is the correct German tax treatment).

### Phase 5: Dashboard + Transaction List Wiring
**Rationale:** The frontend already exists as a beautiful glassmorphism dashboard — it just shows placeholder data. This phase replaces placeholders with real API calls. No new UI components need to be built, only data connections.
**Delivers:** GET /api/summary/:year, GET /api/transactions (paginated with filters), React components wired to real data, KPI cards, transaction table, year selector, tax-relevance flags.
**Addresses:** Dashboard KPIs (table stakes #6), transaction list view (table stakes #5), Freigrenze progress indicator (differentiator D3), Haltefrist countdown (differentiator D2), Recharts portfolio visualizations (differentiator D4).
**Avoids:** L4 (Recharts ResponsiveContainer explicit height), L5 (German number format display only, never back into calculations).
**Research flag:** No additional research needed — standard React API wiring. Recharts 3.8.0 chart API may need verification for specific chart types during implementation.

### Phase 6: PDF Export (Steuerreport)
**Rationale:** The final deliverable — a Finanzamt-ready PDF. Depends on Phase 5 to establish what the report structure should look like. PDFKit's table API is new and needs careful testing with realistic row counts.
**Delivers:** ReportGenerator service, PDF with Anlage SO summary + per-trade appendix + Haltefrist-free table + fees appendix, German Umlauts via embedded TTF font, GET /api/report/:year/pdf endpoint, CSV export for tax advisors.
**Addresses:** Steuerreport generation (table stakes #7), PDF export (table stakes #8), WISO-friendly CSV (differentiator D7).
**Avoids:** M4 (test PDFKit table pagination with 50/100/200 rows), M9 (embed TTF with Latin Extended for ä ö ü ß €).
**Research flag:** Research PDFKit 0.18.0 table API documentation thoroughly during phase planning — it was added in 0.17.0 and is relatively new. Test multi-page table behavior early.

### Phase 7: Exchange API Integration (Optional / Deferred)
**Rationale:** CSV import covers the full historical dataset. API integration adds incremental sync for future trades. Deferred because the adapter interface is designed from Phase 2 — adding ccxt behind the BitgetAdapter interface at this stage is safe.
**Delivers:** ccxt 4.5.44 integration, credential store (AES-256-GCM), exchange settings UI, incremental trade sync from Bitget API.
**Addresses:** Exchange API integration (optional feature), credential storage.
**Research flag:** Needs deeper research on Bitget API v2 pagination limits for deep historical data and ccxt Bitget v2 adapter behavior. The Python reference script only covers price endpoints; full trade history via ccxt is untested.

---

### Phase Ordering Rationale

- **Phases 1-4 are sequential by hard data dependency:** transactions must exist before enrichment, EUR prices must exist before FIFO, FIFO must complete before tax summaries exist for the dashboard.
- **Phase 5 (Dashboard)** starts UI work only after real data exists — showing real numbers rather than building UI against mocked data avoids double rework.
- **Phase 6 (PDF)** comes after the dashboard because the report structure (which fields, which sections) is validated first by looking at the dashboard data.
- **Phase 7 (API)** is deferred because CSV covers all historical data and the adapter interface is already designed to receive it.
- **Testing strategy** runs throughout: FIFO engine unit tests in Phase 4, golden master tests anchored to hand-calculated known-answer scenarios, property-based tests with fast-check for FIFO invariants, and Playwright E2E in Phase 6 when the full pipeline is complete.

---

### Research Flags Summary

| Phase | Needs /gsd:research-phase? | Reason |
|-------|---------------------------|--------|
| Phase 1: Foundation | No | Well-documented stack, verified versions |
| Phase 2: CSV Import | Partial | Verify complete canonical_type mapping against actual CSV data |
| Phase 3: Price Enrichment | Partial | Verify date-fns-tz DST handling; test Bitget API response shapes in Node.js |
| Phase 4: FIFO Engine | Yes | Complex financial domain logic, property-based testing strategy, §22 vs §23 classification edge cases |
| Phase 5: Dashboard | No | Standard React API wiring; Recharts docs available |
| Phase 6: PDF Export | Partial | PDFKit 0.18.0 table API is new — needs targeted testing, not full research |
| Phase 7: API Integration | Yes | ccxt Bitget v2 deep history pagination is untested; credentials architecture needs validation |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via GitHub releases and npm as of 2026-03-21 |
| Features | HIGH (law) / MEDIUM (law specifics) | Bitget formats confirmed by direct file inspection; German tax law from Blockpit guide cross-referenced with training data — no direct BMF source fetched |
| Architecture | HIGH | Monorepo pattern, schema design, pipeline stages, FIFO algorithm all standard and well-documented; SQLite text-decimal pattern confirmed |
| Pitfalls | HIGH | 6 critical and 4 high pitfalls confirmed via direct hex inspection of actual Bitget CSV files — not hypothetical |
| CI/CD | HIGH | All tools and versions verified via official documentation |
| German tax law specifics | MEDIUM | Freigrenze amounts, Haltefrist duration, §23 vs §20 classification: cross-referenced training data and Blockpit guide; BMF Schreiben 10.05.2022 not directly fetched; 10-year Haltefrist question is LOW confidence |

**Overall confidence:** HIGH for the build (we know exactly what to build and how), MEDIUM for tax accuracy (the calculations are correct to the best of available information, but a Steuerberater review is warranted before relying on the output for actual tax filing).

### Gaps to Address

- **Haltefrist exact day count interpretation**: Use ≥365 days; add disclaimer to generated PDF; does not affect implementation timeline.
- **§22 Nr. 3 Freigrenze cliff vs. deduction**: Implement as cliff (256 EUR for earn income); same pattern as spot 1.000 EUR — just a different threshold constant.
- **USDE interest tax treatment**: USDE `Interest` rows in spot CSV are classified as §22 Nr. 3 earn income (not §23 spot gains) — this is the correct treatment for earn product interest but should be documented explicitly and noted in the report.
- **PDFKit 0.18.0 table API maturity**: Unknown edge cases for 50-200 row tables — allocate buffer time in Phase 6 for fallback implementation.
- **WISO Steuer CSV format spec**: Not yet researched; requires targeted research during Phase 3 planning.

---

## Sources

### Primary (HIGH confidence — verified via official docs/releases)
- Hono GitHub releases (honojs/hono, March 14, 2026) — v4.12.8 confirmed
- better-sqlite3 GitHub releases (WiseLibs/better-sqlite3, March 13, 2026) — v12.8.0 confirmed
- Drizzle ORM releases (March 17, 2026) — drizzle-orm 0.45.1, drizzle-kit 0.31.10 confirmed
- PDFKit GitHub releases (foliojs/pdfkit, March 15, 2026) — v0.18.0, table API added in 0.17.0 confirmed
- ccxt GitHub releases (March 17, 2026) — v4.5.44, Bitget v2 certified confirmed
- Node.js release schedule (nodejs.org) — Node.js 22 LTS confirmed as Active LTS in 2026
- Vitest docs (vitest.dev) — v4.1.0, workspace projects, coverage v8 provider confirmed
- Playwright docs (playwright.dev) — v1.58.2, `--with-deps` CI flag confirmed
- Codecov docs (docs.codecov.com) — action v5, codecov.yml reference confirmed
- Claude Code Action docs (code.claude.com) — `anthropics/claude-code-action@v1`, `-p` automation mode confirmed
- Vite docs (vite.dev) — `server.proxy` configuration confirmed
- Bitget API docs — `/api/v2/spot/market/history-candles`, 20 req/s rate limit confirmed
- **Direct Bitget CSV file inspection** (raw-bitget-exports/ directory) — all 5 formats, BOM presence, tab prefix, delimiter change, transaction types confirmed
- **Python reference script** (`references/get_eur_prices_bitget.py`) — Europe/Berlin timezone conversion, COINEUR + COINUSDT×USDTEUR strategy confirmed

### Secondary (MEDIUM confidence — multiple sources agree)
- Blockpit tax guide Germany (blockpit.io/tax-guides/crypto-tax-germany) — Haltefrist, Freigrenze 1.000 EUR, §23 vs §20 classification, Anlage SO lines 48-51
- Koinly German features (koinly.io/de/) — feature categorization, FIFO confirmation
- CoinGecko API pricing (coingecko.com/en/api/pricing) — free tier 30 req/min, 90-day granularity degradation
- Decimal.js docs (mikemcl.github.io/decimal.js/) — arbitrary precision confirmed
- fast-check docs (fast-check.dev) — property testing for FIFO invariants

### Tertiary (LOW confidence — needs validation)
- German tax law: 10-year vs 1-year Haltefrist for staked assets — academic debate, mainstream tools use 1-year; verify with Steuerberater
- German tax law: exact day count for Haltefrist (>365 vs ≥365) — use ≥365 as conservative interpretation
- better-sqlite3 Vitest worker thread issue — known community pattern, test in CI to verify before relying on the `pool: 'forks'` fix

---

*Research completed: 2026-03-21*
*Ready for roadmap: yes*
