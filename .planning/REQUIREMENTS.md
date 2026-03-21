# Requirements: Cryptax

**Defined:** 2026-03-21
**Core Value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.

## v1 Requirements

### Foundation (FOUN)

- [x] **FOUN-01**: Monorepo structure with `packages/frontend`, `packages/backend`, `packages/shared`
- [x] **FOUN-02**: Hono server with SQLite (better-sqlite3 + Drizzle ORM) serves API and static frontend
- [x] **FOUN-03**: Vite dev proxy routes `/api/*` to backend during development
- [x] **FOUN-04**: All monetary values stored as TEXT in SQLite, computed with Decimal.js
- [x] **FOUN-05**: Database migration system via Drizzle Kit
- [x] **FOUN-06**: Replace Aurora background with Floating Lines from reactbits.dev

### Data Import (IMPT)

- [ ] **IMPT-01**: Parse Bitget spot transactions CSV (semicolon-delimited, BOM-stripped, tab-trimmed)
- [ ] **IMPT-02**: Parse Bitget futures transactions CSV (comma-delimited)
- [ ] **IMPT-03**: Parse Bitget spot order history CSV
- [ ] **IMPT-04**: Parse Bitget futures order history CSV
- [ ] **IMPT-05**: Parse Bitget on-chain earn CSV
- [ ] **IMPT-06**: Auto-detect CSV format by header signature (no manual format selection)
- [ ] **IMPT-07**: Normalize all 5 formats into unified transaction schema with canonical types
- [ ] **IMPT-08**: Drag & drop + file picker UI for CSV upload with progress indicator
- [ ] **IMPT-09**: Duplicate detection — skip already-imported transactions by order ID
- [ ] **IMPT-10**: Import validation — flag rows with missing/invalid data, show import summary
- [ ] **IMPT-11**: Multi-year support — import CSVs from any year, tag with tax year

### Exchange API (EXCH)

- [ ] **EXCH-01**: Bitget API connection via ccxt to pull spot trade history
- [ ] **EXCH-02**: Bitget API connection via ccxt to pull futures trade history
- [ ] **EXCH-03**: Exchange connection management UI — add/edit/delete exchange credentials
- [ ] **EXCH-04**: Manual sync trigger — pull latest transactions from connected exchanges
- [ ] **EXCH-05**: Incremental sync — only fetch new transactions since last sync

### Price Resolution (PRCE)

- [ ] **PRCE-01**: Fetch historical EUR price at trade timestamp via Bitget candle API
- [ ] **PRCE-02**: Fallback: COIN→USDT × USDT→EUR conversion when direct EUR pair unavailable
- [ ] **PRCE-03**: CoinGecko fallback for coins not listed on Bitget
- [ ] **PRCE-04**: Price cache in SQLite — don't re-fetch already resolved prices
- [ ] **PRCE-05**: Bulk price enrichment with rate limiting (600 req/min Bitget, 30 req/min CoinGecko)
- [ ] **PRCE-06**: Europe/Berlin timezone handling for all timestamp→UTC conversions
- [ ] **PRCE-07**: Price resolution status — show which transactions still need prices

### Tax Calculation (TAXC)

- [ ] **TAXC-01**: FIFO lot tracking per coin — create lots on buy, consume on sell, track remaining quantity
- [ ] **TAXC-02**: Partial lot splitting — when sell crosses lot boundaries, split and consume proportionally
- [ ] **TAXC-03**: Haltefrist calculation per lot — determine if held ≥365 days at time of sale
- [ ] **TAXC-04**: Spot tax: gains tax-free if Haltefrist met, Einkommensteuer if not, Freigrenze 1.000€ cliff (not deduction)
- [ ] **TAXC-05**: Futures/derivatives tax: Abgeltungssteuer 26,375% (inkl. Soli) on all realized P&L, no Haltefrist
- [ ] **TAXC-06**: Staking/Earn income: Einkommensteuer at EUR value at Zufluss timestamp
- [ ] **TAXC-07**: Fee deduction — trading fees reduce taxable gain (Werbungskosten)
- [ ] **TAXC-08**: Separate tax buckets — Spot (§23 EStG), Futures (§20 EStG), Earn (§22 Nr. 3 EStG) never mixed
- [ ] **TAXC-09**: Per-year tax summary — aggregate taxable amounts by tax year
- [ ] **TAXC-10**: Stateless re-runnable engine — truncate FIFO results and recompute from transactions on every run
- [ ] **TAXC-11**: Block calculation if any transaction has NULL price — correctness gate

### Dashboard (DASH)

- [ ] **DASH-01**: KPI cards with real data: Gesamtgewinn/-verlust, Anzahl Trades, steuerpflichtiger Betrag, geschätzte Steuer
- [ ] **DASH-02**: P&L over time chart (line chart, cumulative gains/losses per month)
- [ ] **DASH-03**: Portfolio distribution chart (pie/donut chart, allocation by coin)
- [ ] **DASH-04**: Gain/loss per coin chart (bar chart, top gainers and losers)
- [ ] **DASH-05**: Monthly performance chart (bar chart, monthly realized gains)
- [ ] **DASH-06**: Spot vs Futures comparison chart (grouped bar or stacked)
- [ ] **DASH-07**: Year selector — switch between tax years, all charts update
- [ ] **DASH-08**: Year-over-year comparison view

### Transactions (TRAN)

- [ ] **TRAN-01**: Transaction list showing all imported transactions with key fields
- [ ] **TRAN-02**: Filter by type (Spot, Futures, Earn, Gebühren), by coin, by date range
- [ ] **TRAN-03**: Search transactions by coin name, order ID, or amount
- [ ] **TRAN-04**: Sort by date, amount, coin, type
- [ ] **TRAN-05**: Category badges (Spot, Futures, Earn, Fee) with color coding
- [ ] **TRAN-06**: Transaction detail view — show full row data, associated FIFO lots, tax impact

### Steuerreport (REPT)

- [ ] **REPT-01**: Anlage SO summary — total taxable spot gains, Freigrenze status, number of transactions
- [ ] **REPT-02**: Anlage KAP summary — total futures/derivatives gains, Abgeltungssteuer amount
- [ ] **REPT-03**: Staking income summary — total Zufluss value per year
- [ ] **REPT-04**: Full trade appendix — every taxable transaction with buy date, sell date, gain/loss, Haltefrist
- [ ] **REPT-05**: PDF export — Finanzamt-ready document with German text, proper formatting, embedded fonts
- [ ] **REPT-06**: CSV export — machine-readable format for Steuerberater
- [ ] **REPT-07**: Report preview in browser before export
- [ ] **REPT-08**: Per-year report selection — generate report for any imported tax year

### Security (SECU)

- [ ] **SECU-01**: Password-protected login screen — single user, locally stored password hash
- [ ] **SECU-02**: Exchange API credentials encrypted at rest with AES-256-GCM (node:crypto)
- [ ] **SECU-03**: Credentials decrypted only in memory using user password via PBKDF2 key derivation
- [ ] **SECU-04**: No credentials in logs, console output, or git commits

### Testing & Quality (TEST)

- [ ] **TEST-01**: Unit tests for FIFO engine with known tax scenarios (golden master tests)
- [ ] **TEST-02**: Unit tests for CSV parsers — all 5 formats with edge cases (BOM, tabs, delimiters)
- [ ] **TEST-03**: Unit tests for tax calculation — Freigrenze cliff, Haltefrist boundary, fee deduction
- [ ] **TEST-04**: Unit tests for price resolution — direct EUR, USDT fallback, missing price handling
- [ ] **TEST-05**: Component tests for React components with Testing Library
- [ ] **TEST-06**: Integration tests for API endpoints (import → calculate → report flow)
- [ ] **TEST-07**: E2E tests with Playwright for critical user flows (import CSV → view dashboard → export report)
- [x] **TEST-08**: 90%+ code coverage enforced via Vitest + Codecov

### CI/CD & DevOps (CICD)

- [x] **CICD-01**: GitHub Actions workflow: lint → test → build on every PR
- [x] **CICD-02**: Claude Code Action v1 for AI-powered PR code review
- [x] **CICD-03**: Codecov integration with 90%+ coverage threshold on PRs
- [x] **CICD-04**: Auto-labeling for PRs based on file paths
- [x] **CICD-05**: Automated release notes / changelog generation
- [x] **CICD-06**: Branch protection on main — require PR, passing CI, code review

## v2 Requirements

### Multi-Exchange CSV Import

- **IMPT-V2-01**: Predefined CSV templates for Binance, Kraken, Coinbase
- **IMPT-V2-02**: Custom CSV format mapper UI

### Advanced Features

- **ADVN-01**: Session timeout / auto-lock after inactivity
- **ADVN-02**: Unrealized gains tracking (current portfolio value vs cost basis)
- **ADVN-03**: WISO Steuer compatible CSV export format
- **ADVN-04**: Tax loss harvesting suggestions
- **ADVN-05**: Multi-exchange API sync for Binance, Kraken, Coinbase via ccxt

### Notifications

- **NOTF-01**: Haltefrist countdown alerts (coin approaching 1-year mark)
- **NOTF-02**: Tax year deadline reminders

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud deployment / hosting | Local-only personal tool |
| Real-time price feeds / portfolio tracking | Historical tax tool, not trading platform |
| Mobile app | Web-first, desktop-optimized |
| ELSTER XML direct submission | Generate human-readable report, not machine filing |
| Tailwind / UI framework | Custom Glassmorphism CSS design system |
| Multi-user / team features | Single-user personal tool |
| Automated Steuererklärung filing | Legal liability — generate report, user files manually |

## Traceability

Testing requirements are distributed to the phase where the code they test lives — tests are written alongside implementation, not in a separate testing phase.

| Requirement | Phase | Notes | Status |
|-------------|-------|-------|--------|
| FOUN-01 | Phase 1 | Foundation + CI/CD | Complete |
| FOUN-02 | Phase 1 | Foundation + CI/CD | Complete |
| FOUN-03 | Phase 1 | Foundation + CI/CD | Complete |
| FOUN-04 | Phase 1 | Foundation + CI/CD | Complete |
| FOUN-05 | Phase 1 | Foundation + CI/CD | Complete |
| FOUN-06 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-01 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-02 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-03 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-04 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-05 | Phase 1 | Foundation + CI/CD | Complete |
| CICD-06 | Phase 1 | Foundation + CI/CD | Complete |
| TEST-08 | Phase 1 | Coverage enforcement — set up from day one | Complete |
| IMPT-01 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-02 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-03 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-04 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-05 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-06 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-07 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-08 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-09 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-10 | Phase 2 | CSV Import Pipeline | Pending |
| IMPT-11 | Phase 2 | CSV Import Pipeline | Pending |
| TEST-02 | Phase 2 | CSV parser tests — written with parsers | Pending |
| PRCE-01 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-02 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-03 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-04 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-05 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-06 | Phase 3 | EUR Price Enrichment | Pending |
| PRCE-07 | Phase 3 | EUR Price Enrichment | Pending |
| TEST-04 | Phase 3 | Price resolution tests — written with enrichment | Pending |
| TAXC-01 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-02 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-03 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-04 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-05 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-06 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-07 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-08 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-09 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-10 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TAXC-11 | Phase 4 | FIFO Engine + Tax Calculation | Pending |
| TEST-01 | Phase 4 | FIFO engine unit tests — written with engine | Pending |
| TEST-03 | Phase 4 | Tax calculation unit tests — written with engine | Pending |
| DASH-01 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-02 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-03 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-04 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-05 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-06 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-07 | Phase 5 | Dashboard + Transaction UI | Pending |
| DASH-08 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-01 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-02 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-03 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-04 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-05 | Phase 5 | Dashboard + Transaction UI | Pending |
| TRAN-06 | Phase 5 | Dashboard + Transaction UI | Pending |
| TEST-05 | Phase 5 | React component tests — written with UI | Pending |
| REPT-01 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-02 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-03 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-04 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-05 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-06 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-07 | Phase 6 | Steuerreport + PDF Export | Pending |
| REPT-08 | Phase 6 | Steuerreport + PDF Export | Pending |
| TEST-06 | Phase 6 | Integration tests — written with report pipeline | Pending |
| TEST-07 | Phase 6 | E2E Playwright — written when full pipeline complete | Pending |
| EXCH-01 | Phase 7 | Exchange API + Security | Pending |
| EXCH-02 | Phase 7 | Exchange API + Security | Pending |
| EXCH-03 | Phase 7 | Exchange API + Security | Pending |
| EXCH-04 | Phase 7 | Exchange API + Security | Pending |
| EXCH-05 | Phase 7 | Exchange API + Security | Pending |
| SECU-01 | Phase 7 | Exchange API + Security | Pending |
| SECU-02 | Phase 7 | Exchange API + Security | Pending |
| SECU-03 | Phase 7 | Exchange API + Security | Pending |
| SECU-04 | Phase 7 | Exchange API + Security | Pending |

**Coverage:**
- v1 requirements: 80 total (note: initial count of 72 was incorrect — 80 requirements enumerated across 11 categories)
- Mapped to phases: 80
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 — traceability revised: TEST-* distributed per-phase, CICD-* moved to Phase 1, SECU-* merged into Phase 7 with EXCH-*; total count corrected to 80*
