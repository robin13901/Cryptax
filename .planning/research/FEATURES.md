# Feature Landscape: Cryptax

**Domain:** Local crypto tax reporting tool — German tax law (EStG § 23)
**Researched:** 2026-03-21
**Scope:** German-focused, Bitget-primary, single-user local tool

---

## German Tax Law Foundation

Before categorizing features, the legal requirements shape every feature decision. These rules are the non-negotiable constraints the feature set must serve.

**Sources (HIGH confidence):** Blockpit tax guide Germany, verified against EStG § 23 references.

### Applicable Law Summary

| Rule | Detail | Implementation Implication |
|------|--------|---------------------------|
| **Haltefrist** | Assets held > 12 months: disposal tax-free (§ 23 Abs. 1 Nr. 2 S. 1 EStG) | FIFO engine must track acquisition date per lot |
| **Freigrenze (Spot)** | Gains ≤ 1.000 EUR/year tax-free (from 2024, was 600 EUR). Exceeding threshold = entire amount taxable | Not just exemption of 1.000 EUR — cliff threshold |
| **Freigrenze (Earn)** | Crypto income (staking, lending) ≤ 256 EUR/year tax-free (§ 22 Nr. 3 EStG) | Separate calculation bucket for income vs. gains |
| **FIFO requirement** | German interpretation favors FIFO for cost basis across mixed lots | Cannot offer LIFO/HIFO as alternatives |
| **Spot tax rate** | Progressive income tax 0–45% (NOT Abgeltungssteuer 25%) | Report as Anlage SO, not Anlage KAP |
| **Futures tax rate** | Flat 25% Abgeltungssteuer + Solidaritätszuschlag = 26,375% | Separate calculation and report line |
| **Staking tax event** | Taxed at time of receipt (Zufluss) at personal income rate | Staking rewards need EUR valuation at receipt timestamp |
| **Taxable events** | Sell, crypto-to-crypto swap, spend on goods/services, futures close | NOT: holding, transfer between own wallets |
| **Anlage SO — Spot** | Lines 48–51: proceeds, acquisition costs, expenses, net gain/loss | Report format must map to these exact lines |
| **Futures classification** | § 20 EStG (Kapitalerträge), not § 23 — separate form path | Futures go to Anlage KAP, not Anlage SO |

**Critical implication:** Futures and spot are taxed under different legal paragraphs and reported on different tax forms. This is the most common German crypto tax mistake.

---

## Table Stakes

**Definition:** Features every serious German crypto tax tool must have. Missing any of these makes the tool unsuitable for its core purpose.

### 1. CSV Import — Bitget Formats

**Why expected:** Without data import, there is nothing to compute.
**Complexity:** Medium
**Dependencies:** None (foundation for everything else)

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Spot transactions CSV | `order;Date;Coin;Type;Amount;Fee;Available` semicolon-delimited | Low |
| Futures transactions CSV | `Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance` comma-delimited | Low |
| Spot order history CSV | `Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,...` | Medium |
| Futures order history CSV | `Date,Order ID,Direction,Coin,Futures,...,Realized P/L,NetProfits,Status` | Medium |
| On-chain earn CSV | `Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status` | Low |
| BOM/encoding handling | Bitget exports have UTF-8 BOM prefix, mixed delimiters, and `\r\n` line endings | Low |
| Duplicate detection | Re-importing same file must not double-count rows | Medium |
| Import feedback | Show row count accepted, skipped, errored — not silent bulk insert | Low |

**Notes:** Bitget uses semicolons for transaction exports but commas for order history exports. Encoding is UTF-8 with BOM. Date format is `YYYY-MM-DD HH:mm:ss`. The tool must handle all five file types correctly.

---

### 2. Historical EUR Price Resolution

**Why expected:** All German tax calculations require EUR amounts at the time of transaction. Bitget stores amounts in crypto or USDT.
**Complexity:** High (most technically uncertain part of the entire project)
**Dependencies:** Data storage (needs prices to be stored permanently to avoid repeated API calls)

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| COIN → EUR direct lookup | For coins traded directly against EUR on Bitget | Low |
| COIN → USDT → EUR chain | For coins traded only against USDT; then USDT/EUR rate at same timestamp | Medium |
| Historical candle API | Bitget public API: `/api/v2/spot/market/history-candles` — 1-minute resolution | Medium |
| Price caching in SQLite | Store fetched prices to avoid re-fetching on every report generation | Medium |
| Missing price handling | When API returns nothing (delisted coin, gap in data) — fallback strategy and user warning | High |
| Price timestamp matching | Match trade timestamp to nearest available candle close price | Medium |

**Notes:** An existing Python reference script (`get_eur_prices_bitget.py`) already implements this pattern. It must be ported to Node.js. The Bitget public spot history-candles API works without authentication. Rate limiting must be respected.

---

### 3. FIFO Engine — Lot Tracking and Cost Basis

**Why expected:** German tax law requires FIFO. Without correct FIFO, tax numbers are wrong.
**Complexity:** High (most calculation-critical component)
**Dependencies:** EUR price resolution must complete before FIFO can run

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Lot acquisition tracking | Per-coin lot with: timestamp, amount, EUR cost basis, exchange | Medium |
| FIFO disposal matching | Match each sell/swap against oldest lots first, consuming partial lots | High |
| Holding period calculation | Per-lot disposal: is acquisition date > 12 months before disposal date? | Medium |
| Partial lot splitting | When sell amount spans multiple lots, must split correctly with separate holding period per sub-lot | High |
| Cost basis calculation | Sell proceeds − weighted cost basis of consumed lots = gain or loss | Medium |
| Fee treatment | Transaction fees reduce net proceeds (or increase cost basis on buy side) | Medium |
| Crypto-to-crypto swap | Swap A→B is a disposal of A (taxable if < 12 months) + acquisition of B | High |
| Lot pool isolation | Lots from separate tax years must remain traceable | Medium |

**Critical edge cases the FIFO engine must handle correctly:**
- Buying the same coin in 5 small lots, then selling more than any one lot covers
- Selling a coin where some lots are > 12 months old (tax-free) and some are < 12 months old (taxable) — must split the disposal correctly
- Receiving staking rewards that later become a disposal lot themselves
- Deposits and withdrawals between own wallets (not taxable events, but affect lot pool)

---

### 4. German Tax Calculation — Three Income Buckets

**Why expected:** The entire purpose of the tool is German tax compliance.
**Complexity:** Medium (once FIFO engine is correct, tax rules apply deterministically)
**Dependencies:** FIFO engine

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Spot gains calculation | Sum of FIFO-matched gains for assets held < 12 months | Low |
| Spot Haltefrist filtering | Exclude from taxable gains any disposal where holding period ≥ 365 days | Low |
| Freigrenze evaluation | If total spot gains ≤ 1.000 EUR: net taxable = 0. If > 1.000 EUR: entire amount taxable | Low (but must be explicit — it's a cliff, not an allowance) |
| Futures P&L calculation | Sum of realized P&L from futures order history (Bitget already provides this) | Low |
| Futures Abgeltungssteuer | 26,375% on net futures gains (25% + 5.5% Soli) | Low |
| Staking/Earn income | Sum of EUR value of all staking rewards at time of receipt | Medium |
| Earn Freigrenze evaluation | If total staking income ≤ 256 EUR: net taxable = 0 | Low |
| Loss offsetting | Losses within same category (spot) offset gains in same tax year | Medium |
| Per-year calculation | Must produce separate results for each tax year in database | Medium |

---

### 5. Transaction List View

**Why expected:** Users must be able to verify that import parsed correctly.
**Complexity:** Medium
**Dependencies:** Data import

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Full transaction list | Paginated or virtualized list of all imported transactions | Medium |
| Category column | Spot Buy, Spot Sell, Futures P&L, Earn Interest, Fee, Deposit, Withdrawal | Low |
| Filterable by year | User selects tax year to analyze | Low |
| Filterable by type | Filter to Spot / Futures / Earn / Fees | Low |
| Search by coin | Filter transactions by coin name | Low |
| Sort by date, amount, gain | Sort controls on table headers | Low |
| Tax relevance flag | Show which transactions are taxable events vs. irrelevant (deposits, own transfers) | Medium |

---

### 6. Dashboard KPIs

**Why expected:** Users need a quick summary view before drilling into details.
**Complexity:** Low-Medium
**Dependencies:** Tax calculation engine

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Gesamtgewinn (year) | Total net realized gain for selected tax year (all categories) | Low |
| Steuerpflichtiger Betrag | Amount actually subject to tax after Freigrenze and Haltefrist | Low |
| Geschätzte Steuer | Estimated tax liability (Spot at marginal rate + Futures at 26.375%) | Medium (requires user to input marginal tax rate) |
| Trade count | Total number of processed transactions | Low |
| Haltefrist-free percentage | Percentage of realized gains that were tax-free due to holding period | Low |
| Year selector | Switch between 2024, 2025, etc. — separate KPIs per year | Low |

---

### 7. Steuerreport Generation

**Why expected:** The reason the tool exists. No report = no value.
**Complexity:** High
**Dependencies:** All calculation components must complete

| Sub-feature | Detail | Complexity |
|-------------|--------|------------|
| Anlage SO summary — Spot section | Lines 48–51: total proceeds, total acquisition costs, total fees, net gain/loss | Medium |
| Futures summary | Net P&L for futures, with applicable tax rate noted | Medium |
| Staking income summary | Total staking income, Freigrenze status, taxable amount | Medium |
| Transaction-level appendix | Every taxable disposal: coin, buy date, sell date, buy EUR, sell EUR, holding days, gain/loss | High |
| Haltefrist table | Separately list disposals exempted by the one-year rule (tax-free, but must be documented) | Medium |
| Fees appendix | All trading fees in EUR, for Werbungskosten deduction claim | Medium |
| PDF export | Browser-native print-to-PDF or jsPDF/PDFMake rendering | High |
| CSV export | Machine-readable version of the same data for tax advisors or WISO import | Medium |
| Tax year selection | Generate report for any year in the database | Low |

---

## Differentiators

**Definition:** Features beyond the minimum that add meaningful value. Not expected by users who just want basic functionality, but justify the tool being "professional quality" rather than hobby-grade.

### D1. Multi-Year Awareness

**Value:** User has 2024 and 2025 data. A tool that only handles one year requires re-importing and re-running everything.
**Complexity:** Medium
**Dependencies:** Data storage schema must support year labels from the start

| Sub-feature | Detail |
|-------------|--------|
| Cross-year FIFO continuity | Lot pool from 2024 carries forward: 2024 buys may be sold in 2025 |
| Per-year report generation | Separate Steuerreport for each year, independent calculations |
| Year-over-year KPI comparison | Dashboard shows 2024 vs 2025 side by side |

---

### D2. Haltefrist Countdown Visualization

**Value:** Shows which currently held positions will become tax-free and when. Directly actionable information.
**Complexity:** Medium
**Dependencies:** FIFO lots with acquisition dates, current holdings

| Sub-feature | Detail |
|-------------|--------|
| Lots reaching 1-year date | List showing: coin, lot amount, acquisition date, days until tax-free |
| Urgency indicator | Highlight lots within 30/60/90 days of 1-year threshold |
| Tax-free unlock date | Per position, show exact date when Haltefrist is reached |

---

### D3. Freigrenze Progress Indicator

**Value:** Real-time view of how close the user is to the 1.000 EUR cliff. Critical for tax-year decisions.
**Complexity:** Low
**Dependencies:** Tax calculation engine

| Sub-feature | Detail |
|-------------|--------|
| YTD gains meter | Progress bar / gauge showing current year gains vs. 1.000 EUR threshold |
| Warning at 80%, 95%, 100% | Visual states: safe, caution, exceeded |
| Separate staking income meter | Same for 256 EUR Freigrenze on Earn income |

---

### D4. Recharts Portfolio Visualizations

**Value:** Tax tools are mostly tables. Charts make patterns visible that tables obscure.
**Complexity:** Medium
**Dependencies:** Data import and calculation engine

| Sub-feature | Detail | Chart Type |
|-------------|--------|------------|
| P&L over time (monthly) | Bar chart: monthly realized gains, colored by taxable/tax-free | Bar chart |
| Portfolio composition | Current holdings split by coin | Pie/Donut chart |
| Per-coin P&L | Which coins contributed how much to total gain/loss | Horizontal bar |
| Spot vs Futures comparison | Two-bar comparison of income sources | Grouped bar |
| Gain/loss waterfall | Cumulative P&L across tax year | Line/area chart |

---

### D5. Transaction Import Validation and Audit Trail

**Value:** Financial data accuracy requires knowing exactly what was imported, when, and from which file.
**Complexity:** Medium
**Dependencies:** Data storage

| Sub-feature | Detail |
|-------------|--------|
| Import session log | Record: file name, import timestamp, row count, rows skipped, rows with errors |
| Data integrity check | On report generation, verify that price data exists for all taxable transactions |
| Unknown transaction type warning | Flag any transaction type not mapped to a known category |
| Manual override capability | Allow user to reclassify a transaction category (e.g., mark a transfer as not own-wallet) |

---

### D6. Tax Scenario Preview (Marginal Rate Input)

**Value:** Spot crypto gains are taxed at personal income rate. The tool cannot know the user's marginal rate — but can calculate the tax at user-supplied rate.
**Complexity:** Low
**Dependencies:** Tax calculation engine

| Sub-feature | Detail |
|-------------|--------|
| Marginal rate input | User enters their Einkommensteuer marginal rate (14% to 45%) |
| Estimated Spot tax | Taxable spot gains × marginal rate |
| Soli check | Show if Solidaritätszuschlag applies (income > ~17K EUR threshold, currently ~16.5K EUR solo or ~33K EUR joint) |

---

### D7. WISO/Elster-Friendly CSV Export

**Value:** Many German users use WISO Steuer or work with tax advisors who use DATEV. A structured CSV that matches their import format eliminates manual re-entry.
**Complexity:** Medium (research needed on WISO import format)
**Dependencies:** Steuerreport generation

| Sub-feature | Detail |
|-------------|--------|
| WISO Steuer import format | Column mapping that matches WISO CSV import spec |
| Tax advisor CSV | Professional format with all fields needed for advisor to review |

---

## Anti-Features

**Definition:** Things that professional crypto tax tools often include but that Cryptax should deliberately NOT build. Building these would waste time, introduce complexity, or conflict with the local-tool design.

### A1. Real-Time Price Feeds

**Anti-pattern:** Live portfolio valuation with current prices.
**Why avoid:** This is a tax tool for historical data, not a portfolio tracker. Live prices require WebSocket connections, rate limiting, subscription management, and create a completely different product category.
**Instead:** Historical prices at transaction time only. Current portfolio value is out of scope.

---

### A2. Multiple Exchange Support

**Anti-pattern:** API connectors for Binance, Kraken, Coinbase, Bybit, etc.
**Why avoid:** Each exchange has a different API, authentication flow, data schema, and rate limiting policy. This is a 10x scope expansion for features the project explicitly rules out. Building a "universal exchange connector" is a full product in itself (CoinTracking has been doing it for 10+ years).
**Instead:** Bitget CSV only for now. If another exchange is needed, the correct approach is adding a new CSV parser, not building API connectors.
**Exception:** Bitget API for historical price resolution is in scope (that is a price-data API, not a trading-data API).

---

### A3. User Authentication and Multi-User

**Anti-pattern:** Login screen, user accounts, session management.
**Why avoid:** This is a single-user local tool. Authentication adds complexity with zero security benefit for a localhost app. Adds maintenance burden, UI complexity, and test surface.
**Instead:** No auth. Local file = local trust. SQLite file is the "account."

---

### A4. Cloud Deployment

**Anti-pattern:** Hosting on Vercel/Railway/AWS with a server and remote database.
**Why avoid:** Fundamentally changes the threat model (now you own someone's financial data), creates GDPR obligations, requires ongoing maintenance costs, and the project is explicitly personal-use only.
**Instead:** localhost only via `npm run dev`.

---

### A5. LIFO or AVCO Cost Basis Methods

**Anti-pattern:** Offering LIFO, HIFO, AVCO as calculation method alternatives alongside FIFO.
**Why avoid:** German tax authorities specifically require FIFO interpretation. Offering alternatives implies the user can choose a method that German law does not accept. A method selector creates false confidence and potential tax compliance risk.
**Instead:** FIFO only, documented explicitly as the German legal standard.

---

### A6. NFT / DeFi / Lending / Derivatives Complex Products

**Anti-pattern:** Full DeFi support — liquidity pool LP token pair tracking, impermanent loss calculation, yield farming rewards, complex structured products.
**Why avoid:** Each DeFi protocol requires custom parsing logic. This is an entire research domain. The user's data is Bitget exchange data (centralized), with on-chain earn staking. Classic LP tracking is not required.
**Instead:** On-chain Earn (simple staking rewards) is in scope. Complex DeFi positions are not. If needed in future, add as a separate phase.

---

### A7. Tailwind CSS / Component Libraries

**Anti-pattern:** Migrating to Tailwind, shadcn/ui, or Material UI.
**Why avoid:** The project has an established Glassmorphism design system with custom CSS. Introducing a utility framework would require full redesign, creates merge conflicts with existing components, and violates the stated constraint.
**Instead:** Continue with custom CSS, GlassSurface component pattern.

---

### A8. ELSTER Direct Submission

**Anti-pattern:** Programmatic submission to ELSTER XML/ERIC API.
**Why avoid:** ELSTER's ERIC API requires a registered application certificate, complex authentication, machine-specific installation, and testing against their sandbox. This is substantial integration work for marginal benefit — the user still reviews the return before filing.
**Instead:** Generate PDF/CSV that the user manually enters into ELSTER or hands to a tax advisor. WISO-compatible CSV covers the automation need.

---

## Feature Dependencies Map

```
CSV Import
    |
    +---> Data Storage (SQLite)
              |
              +---> EUR Price Resolution
              |         |
              |         +---> Price Cache (SQLite)
              |
              +---> FIFO Engine
              |         |
              |         [Requires: EUR prices for all lots]
              |         |
              |         +---> Lot pool with acquisition dates
              |         +---> Disposal matching
              |         +---> Holding period per lot
              |
              +---> Tax Calculation Engine
                        |
                        [Requires: FIFO engine output]
                        |
                        +---> Spot gains (§ 23 EStG)
                        |       +---> Haltefrist filter
                        |       +---> Freigrenze evaluation
                        |
                        +---> Futures P&L (§ 20 EStG)
                        |       +---> Abgeltungssteuer calc
                        |
                        +---> Staking income (§ 22 EStG)
                                +---> Freigrenze evaluation
                                |
                                v
                        Dashboard KPIs
                        Dashboard Charts
                        Transaction List
                        Steuerreport Generation
                                |
                                +---> Anlage SO summary
                                +---> Trade appendix
                                +---> PDF export
                                +---> CSV export
```

---

## MVP vs Post-MVP Recommendation

### MVP (Minimum viable for tax season use)

1. CSV import — all 5 Bitget formats
2. EUR price resolution — Bitget API with SQLite caching
3. FIFO engine — correct lot tracking with Haltefrist
4. Tax calculation — Spot + Futures + Earn (three buckets)
5. Dashboard KPIs — 4 cards (Gesamtgewinn, Trades, Steuerpflichtig, Steuer)
6. Transaction list — basic list with category labels and year filter
7. Steuerreport — Anlage SO summary + trade appendix table
8. PDF export — print-to-PDF acceptable for MVP

### Phase 2 (After MVP works correctly)

- Multi-year cross-FIFO continuity
- Haltefrist countdown visualization
- Freigrenze progress indicator
- Full Recharts dashboard (5 chart types)
- CSV export for tax advisors / WISO
- Import validation and audit trail

### Phase 3 (Nice-to-have polish)

- Marginal rate input for estimated Spot tax
- WISO-specific CSV export format
- Manual transaction category override
- Per-coin P&L drill-down view

---

## Testing Strategy for Financial Accuracy

This section is critical. Tax calculation tools that produce wrong numbers are worse than no tool. Testing strategy must address financial accuracy specifically.

### Test Categories Required

**1. FIFO Engine Unit Tests — Deterministic Scenarios**

Test every state transition with known inputs and verified outputs. Do not test with real Bitget data at this level — test with constructed minimal scenarios.

| Scenario | Why Critical |
|----------|-------------|
| Single buy, single sell within 12 months | Baseline: taxable gain |
| Single buy, single sell after 12 months | Baseline: tax-free gain |
| Two buys at different prices, sell more than first lot | Partial lot consumption, weighted cost basis |
| Three buys, sell spanning all three lots | Full FIFO chain |
| Buy at 500 EUR, sell at 400 EUR (loss) | Loss calculation |
| Buy same coin 5× in the same day | Same-day lots with different prices |
| Sell exactly at lot boundary (no partial lot) | Edge case: no rounding needed |
| Cross-year FIFO: buy in Dec 2024, sell in Jan 2025 | Lot from previous tax year |
| Crypto-to-crypto swap as taxable disposal | Not a "sell" in UI but creates a tax event |
| Staking reward received, later sold | Staking reward becomes a lot with cost basis at receipt EUR price |

**2. Freigrenze Boundary Tests — Cliff Arithmetic**

The Freigrenze cliff (gains of 999 EUR → 0 EUR taxable; gains of 1.001 EUR → 1.001 EUR taxable) is where bugs are financially costly.

| Scenario | Expected |
|----------|----------|
| Gains = 999.99 EUR | Net taxable = 0 |
| Gains = 1000.00 EUR | Net taxable = 0 (at the limit, still exempt) |
| Gains = 1000.01 EUR | Net taxable = 1000.01 EUR (entire amount) |
| Gains = 1000.00 EUR + 0.01 EUR fee-reduced-to-999.99 | Net taxable = 0 |
| Staking income = 256.00 EUR | Net taxable = 0 |
| Staking income = 256.01 EUR | Net taxable = 256.01 EUR |

**3. Tax Calculation Precision Tests**

EUR amounts from crypto always involve long decimals (e.g., 0.00067825 BTC × 32000.41 EUR). Floating-point arithmetic will accumulate errors. Test that:

- All monetary values use consistent rounding (round half-up to 2 decimal places for EUR display; keep full precision internally)
- FIFO lot arithmetic: buying 0.3 + 0.3 + 0.4 = 1.0 (not 0.9999...7)
- Sum of per-transaction gains equals total gain (no centimes lost in rounding)

**Recommendation:** Use integer arithmetic internally (store amounts as integers × 10^8 satoshis) or use a decimal library (e.g., `decimal.js`) rather than native JavaScript floats for all financial calculations.

**4. CSV Parsing Tests — Format Variations**

| Scenario | Why |
|----------|-----|
| UTF-8 BOM prefix on file | Bitget exports include BOM — parser must strip it |
| Semicolon vs comma delimiter | Different Bitget export types use different delimiters |
| Empty rows | File may have trailing newlines |
| Windows CRLF line endings | `\r\n` in Bitget exports |
| Amount with or without decimal | `500` vs `500.00` vs `0.00067825` |
| Date format `YYYY-MM-DD HH:mm:ss` | UTC or local time? Must verify and be consistent |
| Re-import same file | Duplicate detection must block re-insertion |

**5. Golden Master Tests — Report Output**

For the Steuerreport, construct a fixed minimal dataset (e.g., 10 hand-calculated transactions) and assert the generated PDF/CSV matches known-correct values. This "golden master" test catches regressions after refactoring the calculation engine.

```
Fixed input:
  - Buy 1 BTC on 2024-01-15 for 35,000 EUR
  - Buy 0.5 BTC on 2024-06-01 for 20,000 EUR (= 40,000 EUR/BTC)
  - Sell 0.8 BTC on 2024-11-20 for 36,000 EUR/BTC = 28,800 EUR proceeds

Expected FIFO output:
  - Lot 1: 0.8 BTC of 1 BTC lot, cost basis = 0.8 × 35,000 = 28,000 EUR
  - Gain: 28,800 − 28,000 = 800 EUR (taxable, held < 12 months)
  - Remaining: 0.2 BTC from Lot 1 + 0.5 BTC from Lot 2
  - Freigrenze: 800 EUR < 1,000 EUR → net taxable = 0 EUR
```

**6. Integration Tests — Full Pipeline**

Test the end-to-end flow from CSV file to Steuerreport with real (anonymized or synthetic) data that matches actual Bitget export format. Verify:
- Row count in database matches CSV row count minus invalid rows
- Every row that needed a EUR price got one
- Report totals match sum of individual transaction rows
- Same input always produces same output (determinism)

---

## Complexity Summary

| Feature Area | Complexity | Phase Recommendation |
|--------------|------------|---------------------|
| CSV Import (5 formats) | Medium | Phase 1 |
| EUR Price Resolution | High | Phase 1 |
| FIFO Engine | High | Phase 1 |
| Tax Calculation (3 buckets) | Medium | Phase 1 |
| Dashboard KPIs (4 cards) | Low | Phase 1 |
| Transaction list | Medium | Phase 1 |
| Steuerreport (summary + appendix) | High | Phase 1 |
| PDF export | Medium | Phase 1 |
| Charts (5 types) | Medium | Phase 2 |
| Multi-year FIFO continuity | Medium | Phase 2 |
| Haltefrist countdown | Medium | Phase 2 |
| Freigrenze indicator | Low | Phase 2 |
| CSV export (tax advisor) | Medium | Phase 2 |
| Import audit trail | Medium | Phase 2 |
| WISO CSV format | Medium | Phase 3 |
| Marginal rate input | Low | Phase 3 |
| Manual category override | Medium | Phase 3 |

---

## Sources

| Source | Confidence | What It Informed |
|--------|------------|-----------------|
| Blockpit tax guide Germany (blockpit.io/tax-guides/crypto-tax-germany) | HIGH | Haltefrist, Freigrenze, Anlage SO lines 48–51, FIFO requirement, futures vs spot tax treatment, staking classification |
| Koinly German features page (koinly.io/de/) | MEDIUM | Feature categorization, import methods, SOC2/ISO certifications for security |
| Blockpit German features (blockpit.io/de-de/) | MEDIUM | Haltefristen/Freigrenzen/FIFO confirmation, WISO compatibility, ELSTER compatibility |
| CoinTracking features page (cointracking.info) | MEDIUM | Feature scope of professional tools: 13 calc methods, 27+ reports, BMF compliance |
| Bitget CSV analysis (actual files in project) | HIGH | Exact column schemas, delimiter types, encoding, data types for all 5 export formats |
| PROJECT.md (project context) | HIGH | Scope boundaries, design constraints, stack decisions, existing features |

---
*Research date: 2026-03-21 | Confidence: HIGH for German tax law, HIGH for Bitget format specifics, MEDIUM for competitor feature scope*
