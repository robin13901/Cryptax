# Technology Stack

**Project:** Cryptax — Local German Crypto Tax Reporting Tool
**Researched:** 2026-03-21
**Mode:** Stack dimension research — brownfield addition to existing React 19 + Vite 8 + TypeScript 5.9 SPA

---

## Existing Frontend (Do Not Change)

| Technology | Version | Status |
|------------|---------|--------|
| React | 19.2.4 | Installed |
| Vite | 8.0.0 | Installed |
| TypeScript | 5.9.3 | Installed |
| Recharts | 3.8.0 | Installed |
| motion/react | 12.36.0 | Installed |
| ogl | 1.0.11 | Installed (WebGL for Floating Lines) |

---

## Recommended Backend Stack

### 1. Backend Framework: Hono

**Recommendation:** Hono 4.12.8 with `@hono/node-server`

**Rationale:**
- Hono is TypeScript-first with full type inference — no separate `@types/*` package needed unlike Express
- Tiny bundle, web-standard Request/Response API, zero dependencies beyond the adapter
- Built-in middleware covers all needs: CORS, static file serving, JWT, body parsing
- `@hono/node-server` adapter serves the Vite-built frontend dist directory directly, allowing a single `npm start` to serve both frontend and API
- Significantly simpler TypeScript integration than Fastify, which requires explicit type providers and more boilerplate
- For a local tool with no production traffic concerns, Fastify's performance advantage is irrelevant

**Why not Express:** Requires `@types/express`, has no native TypeScript support, uses old callback-style middleware, and Express 5 is still in release candidate as of early 2026. Express is the legacy choice.

**Why not Fastify:** More boilerplate for TypeScript type safety (type providers, explicit generic annotations). Overkill for a local single-user tool.

```bash
npm install hono @hono/node-server
```

**Confidence:** HIGH — verified via official hono.dev docs and GitHub releases (v4.12.8, March 14, 2026)

---

### 2. SQLite Driver: better-sqlite3 + Drizzle ORM

**Recommendation:** better-sqlite3 12.8.0 + drizzle-orm 0.45.1 + drizzle-kit 0.31.10

**Two-layer approach:**
- `better-sqlite3` as the synchronous driver (thin, native, battle-tested)
- `drizzle-orm` as the type-safe ORM layer (schema definition, migrations, query builder)

**Why better-sqlite3 over node:sqlite:**

The built-in `node:sqlite` (available since Node.js 22.5.0, no longer experimental as of v23.4.0) is an attractive zero-dependency option. However:
- Status is still "Release Candidate" (Stability 1.2) — not yet production-stable
- Drizzle ORM officially supports `better-sqlite3` but not `node:sqlite` as of this writing
- `better-sqlite3` v12.8.0 bundles SQLite 3.51.3, has mature production track record, and supports FIFO batch transactions efficiently

**Note for future revisit:** `node:sqlite` will likely replace `better-sqlite3` in Node.js 24+ LTS once fully stable. If the project is still active then, it is worth migrating.

**Why Drizzle ORM over raw better-sqlite3 SQL:**
- Type-safe schema definitions compiled from TypeScript types
- Migration system via `drizzle-kit` (version-controlled DDL changes)
- Query builder prevents SQL injection in dynamic filter conditions (transaction search/filter)
- Drizzle v1.0.0-beta.18 includes improved migration tracking with hash-based versioning

**Why not Kysely:** Kysely is a query builder only — no migration system. You'd still need a separate migration tool. Drizzle covers both.

**Why not Prisma:** Heavily opinionated, generates a runtime client, has a separate query engine binary. Massively over-engineered for a local SQLite app. Cold start overhead, bloated install.

```bash
npm install better-sqlite3 drizzle-orm
npm install -D drizzle-kit @types/better-sqlite3
```

**Confidence:** HIGH — versions verified via GitHub releases (better-sqlite3 v12.8.0 March 13, 2026; drizzle-orm v0.45.1/drizzle-kit 0.31.10 March 17, 2026)

---

### 3. CSV Parsing: csv-parse

**Recommendation:** csv-parse 6.2.1 (part of the `csv` monorepo)

**Rationale:**
- The Bitget CSV exports use inconsistent delimiters: some files use semicolons, others commas (documented in PROJECT.md)
- `csv-parse` supports dynamic delimiter detection, custom column mapping, and header-based parsing
- Sync API (`parse(input, {columns: true})`) is available for simple cases; stream API for large files (not needed here — 3,400 rows)
- Battle-tested: used in many production data pipelines, zero external dependencies
- Type definitions built-in

**Why not Papa Parse:** Papa Parse focuses on browser-based parsing. Its Node.js documentation is sparse and it lacks the fine-grained API control needed for multi-schema CSV files with different delimiters.

**Why not fast-csv:** Similar capability but csv-parse has better TypeScript types and more flexible column transform options.

**Implementation note:** Each Bitget CSV export type has a different schema. Build a parser factory with schema definitions per export type, then map all formats to a canonical `Transaction` type. This is where the complexity lives — the library choice is secondary.

```bash
npm install csv-parse
```

**Confidence:** HIGH — version verified via npm (csv-parse 6.2.1), official docs at csv.js.org

---

### 4. PDF Generation: PDFKit

**Recommendation:** pdfkit 0.18.0

**Rationale:**
- PDFKit 0.18.0 introduced native table support (added in 0.17.0) — this is critical for Finanzamt-ready tax reports with structured trade tables
- Pure JavaScript, no native dependencies, runs in Node.js without compilation issues
- Full control over layout: custom fonts (for German Umlauts), precise positioning, headers/footers, page numbers
- Supports PDF/A for archival compliance (relevant for Finanzamt documents)
- The Steuerreport requires: summary table (Anlage SO fields), per-trade detail appendix, totals rows, EUR formatting — all achievable with PDFKit tables

**Why not @react-pdf/renderer (react-pdf):** Current version is 4.3.2. While it supports server-side rendering, it uses React as a layout engine, creating a tight coupling between the PDF structure and the React component tree. Changes to PDF layout require React component changes. For a backend service generating documents, direct programmatic generation is more maintainable. Also adds React as a Node.js dependency on the backend.

**Why not Puppeteer (HTML-to-PDF):** Puppeteer launches a Chromium instance — heavy (150MB+), slow startup, not suitable for on-demand generation in a local tool. Overkill.

**Why not pdf-lib:** pdf-lib 1.17.1 is excellent for modifying existing PDFs but has no table support and requires manual coordinate-based layout. Building a structured tax report from scratch would require hundreds of lines of manual positioning. Last release was November 2022, suggesting reduced maintenance.

**German tax report layout needed:**
- Page header with taxpayer info and tax year
- Anlage SO summary table: columns for Coin, Kaufdatum, Verkaufsdatum, Kaufpreis, Verkaufspreis, Gewinn/Verlust
- Futures section with Abgeltungssteuer calculation
- Earn/Staking section
- Totals with 1.000€ Freigrenze calculation and final taxable amount
- Page numbers and footer

```bash
npm install pdfkit
npm install -D @types/pdfkit
```

**Confidence:** MEDIUM-HIGH — version verified via GitHub releases (pdfkit 0.18.0, March 15, 2026). Table feature is new (added 0.17.0) — test thoroughly in Phase implementation.

---

### 5. Historical Price API: Bitget Public API (Primary) + CoinGecko (Fallback)

**Recommendation:** Bitget `/api/v2/spot/market/history-candles` as primary; CoinGecko `/coins/{id}/market_chart/range` as secondary fallback

#### 5a. Bitget History Candles API (Primary)

**Endpoint:** `GET https://api.bitget.com/api/v2/spot/market/history-candles`

**Parameters:**
- `symbol`: e.g. `BTCEUR` or `BTCUSDT`
- `granularity`: `1min`, `5min`, `1h`, `1day`, etc.
- `endTime`: millisecond unix timestamp
- `limit`: up to 200 candles

**Why this is the best choice:**
- The existing Python script already validates this approach (see `references/get_eur_prices_bitget.py`)
- **Exchange-matched prices**: All trades in the dataset are Bitget trades — using Bitget prices means cost basis equals execution context
- 1-minute granularity provides price at exact trade timestamp
- No API key required for historical candles (public endpoint)
- Rate limit: 20 requests/second (1,200/minute) — verified in API docs
- Strategy: try `COINEUR` direct first; fall back to `COINUSDT * USDTEUR` (exactly as Python script does)
- Node.js implementation uses the built-in `fetch` API (Node.js 18+, no axios needed)

**Limitation:** Some small-cap coins listed on Bitget may not have direct EUR or even USDT pairs (delisted tokens). Need a fallback.

#### 5b. CoinGecko Free API (Fallback)

**Endpoint:** `GET https://api.coingecko.com/api/v3/coins/{id}/history?date=DD-MM-YYYY`

**Why as fallback only:**
- Free tier: 30 requests/minute, 10,000 call credits/month — not sufficient for bulk re-fetching all 3,400 transactions
- Granularity degrades beyond 90 days: >90 days from query = daily data only (not per-hour/minute)
- 2-year historical data cap on free tier (Bitget API has no such cap)
- CoinGecko provides EUR prices in the response `market_data.current_price.eur`

**Why not CryptoCompare:** CryptoCompare redirects to CoinDesk Data as of early 2026 — the original API domain has been absorbed into a rebranded service. This creates integration uncertainty. Avoid.

**Price resolution strategy:**
```
1. Check local DB cache (avoid re-fetching already resolved prices)
2. Try Bitget COINEUR 1min candle at timestamp
3. Try Bitget COINUSDT * USDTEUR 1min candle at timestamp
4. Try CoinGecko /coins/{id}/history (daily granularity)
5. Mark as "unresolved" — flag for manual entry
```

```bash
# No additional library needed — use Node.js built-in fetch
# For CoinGecko fallback, consider rate limiter:
npm install p-throttle
```

**Confidence:** HIGH for Bitget API (production-tested in Python script); MEDIUM for CoinGecko fallback (rate limit and granularity constraints verified via official pricing page)

---

### 6. Exchange API Integration: ccxt

**Recommendation:** ccxt 4.5.44

**Rationale:**
- ccxt is the industry-standard unified exchange API library for JavaScript/TypeScript
- Supports 100+ exchanges including Bitget (CCXT Certified, API v2)
- Key methods for Cryptax: `fetchMyTrades()`, `fetchOrders()`, `fetchOHLCV()`, `fetchDeposits()`, `fetchWithdrawals()`
- TypeScript types built-in
- Bitget v2 API is actively maintained in ccxt (confirmed in changelog: "update ws order status", ongoing improvements)
- Required credentials: API Key + Secret + Passphrase (Bitget requires all three)

**Use case in Cryptax:** Pull trade history directly from exchange instead of/in addition to CSV import. This is a secondary import path — CSV import is primary (user already has exports).

**Why not a custom Bitget API client:** ccxt handles pagination, rate limiting, error normalization, timestamp handling, and provides a uniform interface. Writing a custom client for even one exchange is significant maintenance burden.

**Important limitation:** ccxt fetches recent history efficiently, but deep historical data (full 2+ years) may require pagination and hit rate limits. For initial data load, CSV import is faster and more reliable. ccxt is best for incremental sync (new trades since last import).

```bash
npm install ccxt
```

**Confidence:** HIGH — version verified via GitHub releases (v4.5.44, March 17, 2026). Bitget v2 support confirmed in README and changelog.

---

### 7. Local Authentication and Encrypted Credential Storage

**Context:** This is a local single-user tool. There is no login page and no user accounts. "Authentication" here means:
1. Protecting the app when browser is left open
2. Storing exchange API keys (Bitget key/secret/passphrase) securely on the local machine

#### 7a. App-Level Protection

**Recommendation:** Simple localhost PIN using `node:crypto` AES-256-GCM encryption + session cookie

- On first launch: user sets a PIN (4-8 digits or passphrase)
- PIN hashed with bcrypt (cost factor 12), stored in a local config file
- Express/Hono middleware checks session cookie on each request
- No external auth library needed — the threat model is "unattended laptop", not "internet attacker"

**Why not keytar:** keytar v7.9.0 was archived on December 15, 2022 and is read-only. It is abandoned software. Do not use.

**Why not Electron safeStorage:** This is not an Electron app.

#### 7b. Exchange API Key Storage

**Recommendation:** AES-256-GCM encryption via `node:crypto`, keys stored in an encrypted JSON file alongside the SQLite database

```typescript
// Pseudocode
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Encryption key derived from user PIN via PBKDF2 (100,000 iterations)
// IV generated fresh per credential entry
// Ciphertext + IV + auth tag stored in credentials.enc.json
```

**Why this approach:**
- Zero external dependencies (uses Node.js 23 built-in `node:crypto`)
- AES-256-GCM provides authenticated encryption — detects tampering
- Key derivation via PBKDF2 with salt means brute-forcing the PIN is expensive
- Credentials never stored in plaintext; never committed to git
- Simple to implement, audit, and understand

**Libraries needed:**
```bash
npm install bcryptjs  # for PIN hashing (pure JS, no native addon issues)
```

**Confidence:** HIGH — `node:crypto` AES-256-GCM confirmed available in Node.js 23 via official release notes. bcryptjs is pure-JS fallback for bcrypt (avoids native addon complications on Windows).

---

### 8. Testing Stack

#### 8a. Unit and Integration Tests: Vitest

**Recommendation:** Vitest 4.1.0

**Rationale:**
- Already the natural choice given the Vite-based frontend — Vitest shares Vite's transform pipeline
- v4.1.0 supports workspace/projects feature for running frontend (jsdom/happy-dom environment) and backend (node environment) tests in a single process
- Vitest 4.x requires Node.js 18+ (current project runs Node.js 23 — fine)
- Built-in TypeScript support, ESM-first, fast watch mode
- Compatible with jest-style APIs — minimal migration cost if tests are written

**Workspace configuration approach:**
```typescript
// vitest.config.ts
export default {
  test: {
    projects: [
      { test: { name: 'frontend', environment: 'jsdom', include: ['src/**/*.test.ts'] } },
      { test: { name: 'backend', environment: 'node', include: ['server/**/*.test.ts'] } }
    ]
  }
}
```

**Critical test areas:**
- FIFO engine unit tests (pure functions, no I/O — easy to test exhaustively)
- Tax calculation tests with known fixtures (test against known German tax rule outcomes)
- CSV parser tests for all 5 Bitget export formats
- Price resolution strategy tests (mock HTTP)
- Database layer tests (use in-memory SQLite)

#### 8b. Component Tests: @testing-library/react

**Recommendation:** @testing-library/react 16.3.2

- React 19 support added in v16.1.0 (December 2024), confirmed by official release notes
- Used with Vitest's jsdom environment
- Tests user-visible behavior, not implementation details (correct approach for chart/filter UI)

```bash
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

#### 8c. End-to-End Tests: Playwright

**Recommendation:** @playwright/test 1.52.x (latest — installed via `npm init playwright@latest`)

- Requires Node.js 20+ (current: 23 — fine)
- UI Mode for interactive debugging during development
- Test the full flow: CSV import → transaction list → tax calculation → PDF download
- Run against the local dev server (`http://localhost:5173` Vite + `http://localhost:3000` Hono)

```bash
npm install -D @playwright/test
npx playwright install chromium  # install just Chromium, skip Firefox/WebKit for local tool
```

**Confidence:** HIGH — all versions verified: Vitest 4.1.0 (official docs), @testing-library/react 16.3.2 (GitHub releases January 2026), @playwright/test 1.58.2 (installation docs).

---

### 9. Recharts 3.x Best Practices for Financial Dashboards

**Current version:** 3.8.0 (already installed, released March 6, 2025)

**Key practices for the Cryptax dashboard:**

#### Time Series (P&L Over Time, Monthly Performance)
- Use `ComposedChart` with `Line` + `Area` for equity curves
- Always use `ResponsiveContainer` with `width="100%"` and explicit `height`
- Pass timestamps as numeric values (milliseconds) to XAxis `dataKey`, use `tickFormatter` to format as `DD.MM.YYYY` (German locale)
- For monthly bars: use `BarChart` with `XAxis tickFormatter={v => format(v, 'MMM yy', { locale: de })}`

#### Tooltips for EUR Financial Data
- Custom `<Tooltip content={<CustomTooltip />}>` to format values as `€ 1.234,56` (German number format: period for thousands, comma for decimal)
- Dark theme tooltip: match glassmorphism style via custom CSS class

#### Portfolio Distribution (Pie Chart)
- `PieChart` with `innerRadius` (donut style) — matches the Glassmorphism aesthetic
- Use `Cell` components with the project color palette (Blue #0070F2, Green #5fdc8a, etc.)
- Limit slices to top 8 coins, aggregate remainder as "Sonstige"

#### Recharts 3.x Breaking Changes vs 2.x
- React 18 concurrent mode support improved in 3.x — animations may behave differently
- `Customized` component API changed; verify any custom shapes
- TypeScript generics for chart data improved in 3.8.0 — use typed `data` props

**Confidence:** MEDIUM — version confirmed via GitHub releases. Best practices are training-data informed with reference to Recharts 3.8.0 changelog; verify specific API signatures during implementation.

---

## Complete Recommended Stack

### Backend (New)

| Technology | Version | Purpose |
|------------|---------|---------|
| hono | 4.12.8 | HTTP server framework |
| @hono/node-server | latest | Node.js adapter for Hono |
| better-sqlite3 | 12.8.0 | SQLite driver (sync) |
| drizzle-orm | 0.45.1 | ORM + type-safe query builder |
| drizzle-kit | 0.31.10 | Migration CLI |
| csv-parse | 6.2.1 | CSV parsing for Bitget exports |
| pdfkit | 0.18.0 | PDF report generation |
| ccxt | 4.5.44 | Exchange API (Bitget + others) |
| bcryptjs | latest | PIN hashing (pure JS) |
| p-throttle | latest | Rate limiter for price API calls |

### Testing (New)

| Technology | Version | Purpose |
|------------|---------|---------|
| vitest | 4.1.0 | Unit + integration tests |
| @testing-library/react | 16.3.2 | Component tests |
| @testing-library/user-event | latest | User interaction simulation |
| @testing-library/jest-dom | latest | Custom DOM matchers |
| @playwright/test | 1.58.2 | End-to-end tests |

### Types and Dev Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| @types/better-sqlite3 | latest | TypeScript types for driver |
| @types/pdfkit | latest | TypeScript types for PDFKit |
| tsx | latest | Run TypeScript directly (for backend dev) |

---

## Alternatives Considered and Rejected

| Category | Recommended | Rejected | Reason |
|----------|-------------|----------|--------|
| Framework | Hono | Express 5 | RC status, callback-style, @types/* required |
| Framework | Hono | Fastify | More boilerplate for TS, overkill for local tool |
| SQLite driver | better-sqlite3 | node:sqlite | Still Release Candidate stability; Drizzle doesn't support it yet |
| ORM | Drizzle | Prisma | Binary engine, massive footprint, overkill for SQLite |
| ORM | Drizzle | Kysely | Query builder only, no migrations |
| CSV | csv-parse | Papa Parse | Poor Node.js docs, less flexible multi-schema support |
| PDF | PDFKit | @react-pdf/renderer | Adds React dependency to backend, less direct control |
| PDF | PDFKit | Puppeteer | 150MB Chromium dependency, slow startup |
| PDF | PDFKit | pdf-lib | No table support, last updated Nov 2022, requires manual coordinate layout |
| Price API | Bitget + CoinGecko fallback | CryptoCompare | Rebranded to CoinDesk Data, uncertain integration status |
| Credentials | node:crypto AES-256-GCM | keytar | Archived December 2022, abandoned |
| E2E | Playwright | Cypress | Playwright is lighter, supports multiple browsers, better CI story |

---

## Installation Summary

```bash
# From project root — backend server package
mkdir server && cd server
npm init -y

# Backend runtime dependencies
npm install hono @hono/node-server better-sqlite3 drizzle-orm csv-parse pdfkit ccxt bcryptjs p-throttle

# Backend dev dependencies
npm install -D drizzle-kit tsx @types/better-sqlite3 @types/pdfkit typescript

# Testing (add to dashboard/ or root package)
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
```

---

## Sources

| Claim | Source | Confidence |
|-------|--------|------------|
| Hono v4.12.8, Node.js adapter | https://github.com/honojs/hono/releases (March 14, 2026) | HIGH |
| Hono Node.js static serving | https://hono.dev/docs/getting-started/nodejs | HIGH |
| better-sqlite3 v12.8.0, SQLite 3.51.3 | https://github.com/WiseLibs/better-sqlite3/releases (March 13, 2026) | HIGH |
| drizzle-orm v0.45.1, better-sqlite3 support confirmed | https://orm.drizzle.team/docs/get-started/sqlite-new | HIGH |
| drizzle-kit 0.31.10, migration features | https://github.com/drizzle-team/drizzle-orm/releases (March 17, 2026) | HIGH |
| csv-parse 6.2.1 | npm view csv-parse version | HIGH |
| pdfkit 0.18.0, table support added in 0.17.0 | https://github.com/foliojs/pdfkit/releases (March 15, 2026) | HIGH |
| ccxt v4.5.44, Bitget v2 certified | https://github.com/ccxt/ccxt/releases (March 17, 2026) | HIGH |
| CoinGecko free tier limits (30 req/min, 2yr history) | https://www.coingecko.com/en/api/pricing | MEDIUM |
| Bitget history-candles API v1 parameters | https://bitgetlimited.github.io/apidoc/en/spot/#get-history-candle-data | HIGH |
| Bitget v2 API in Python script | /c/SAPDevelop/Privat/Cryptax/references/get_eur_prices_bitget.py | HIGH |
| CryptoCompare → CoinDesk redirect | WebFetch redirect detected | MEDIUM |
| keytar archived December 2022 | https://github.com/atom/node-keytar | HIGH |
| node:crypto AES-256-GCM in Node.js 23 | https://nodejs.org/en/blog/release/v23.0.0 | HIGH |
| node:sqlite stability (RC 1.2) | https://nodejs.org/docs/latest/api/sqlite.html | HIGH |
| Vitest 4.1.0, workspace projects | https://vitest.dev/guide/ | HIGH |
| @testing-library/react 16.3.2, React 19 support | https://github.com/testing-library/react-testing-library/releases | HIGH |
| @playwright/test 1.58.2 | npm view @playwright/test version | HIGH |
| Recharts 3.8.0 release date | https://github.com/recharts/recharts/releases | HIGH |
| Fastify v5.8.2 | https://fastify.dev/docs/latest/Guides/Getting-Started/ | HIGH |
