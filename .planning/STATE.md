# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport.
**Current focus:** Phase 9 (Electron Desktop App) — In progress

## Current Position

Phase: 9 of 9 (Electron Desktop App)
Plan: 3 of 6 in phase
Status: In progress
Last activity: 2026-03-27 — Completed 09-03-PLAN.md (Electron main process, preload, db-path, server modules)

Progress: [█████████░] 95% (58/61 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 33
- Average duration: ~8 min
- Total execution time: ~240 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-ci-cd | 7/7 COMPLETE | ~44 min | ~6 min |
| 02-csv-import-pipeline | 8/8 COMPLETE | ~46 min | ~6 min |
| 03-eur-price-enrichment | 5/5 COMPLETE | ~50 min | ~10 min |
| 04-fifo-engine-tax-calculation | 8/8 COMPLETE | ~61 min | ~8 min |
| 05-dashboard-transaction-ui | 7/7 COMPLETE | ~75 min | ~11 min |

**Recent Trend:**
- Last 5 plans: 10 min
- Trend: consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 04-01: HALTEFRIST_DAYS=366 — conservative: Jan 1 buy is tax-free Jan 2 next year (366 days elapsed)
- 04-01: Decimal import in NodeNext must be named export { Decimal } from 'decimal.js' — default/re-export resolves to namespace only
- 04-01: checkNullPrices returns empty array on pass, array of NullPriceError on failure — caller decides abort
- 04-01: SKIPPABLE_CANONICAL_TYPES = transfer_in/out, earn_withdrawal, fee, unknown — intentionally excluded from NULL price check
- 04-02: Fee conversion uses eurPrice multiplier for both spot_tx and spot_order (feeEur = fee * eurPrice) — consistent approximation
- 04-02: Excess sell generates both consumption records AND sellsWithoutLots entry — partial match + error flag
- 04-02: FIFO tiebreak: buys (key=0) before sells (key=1) at same timestamp
- 04-03: Futures opens (open_long/short) skipped — opening a position is not a taxable event under German law
- 04-03: Fee sign convention: feeEur stored as positive abs() value; source amounts are negative but reporting uses positive fees
- 04-03: Set-based FUTURES_TAXABLE_TYPES guard — clean O(1) filter over switch/if chains
- 04-04: Freigrenze cliff uses netGainEur only (haltefristMet=false records); tax-free gains excluded from net entirely
- 04-04: Haltefrist-met losses are ignored (no tax benefit, no liability); only non-exempt records enter netting
- 04-04: tradeCount via Set<number> on sellTransactionId — unique sells, not lot pairings
- 04-05: Freigrenze not applied in earn engine — deferred to orchestrator for per-year aggregate cliff check
- 04-05: earn_withdrawal skipped with specific reason (distinguishes from generic non-earn skip)
- 04-05: FIFO lot feeEur = ZERO — earn has no acquisition cost beyond the fair market value
- 04-05: costPerUnitEur = eurPrice directly — cost basis is purely fair market value at receipt (no fee adjustment)
- 04-06: Earn lots fed into FIFO via synthetic buy transactions (canonicalType='buy') — earn engine still runs separately for §22 income records
- 04-06: §23 estimatedTaxEur = 0 — marginal rate unknown; only Abgeltungssteuer (futures, 26.375%) is computable without user tax data
- 04-06: Earn Freigrenze cliff at 256 EUR applied at orchestrator level per-year aggregate
- 04-06: Futures net P&L = sum(realizedPnlEur) - sum(feeEur) per year; only positive net is taxable (no Freigrenze)
- 04-06: DB writes inside single db.transaction() — atomic: either all 5 tables written or none
- 04-08: Golden master tests reuse in-memory SQLite + full migrations pattern — no mocking
- 04-08: Property tests target runFifoEngine directly (pure function, no DB) — faster, 100 runs each
- 05-01: engineHasRun guard uses SELECT 1 FROM tax_summaries LIMIT 1 — cheapest probe, distinguishes no-engine-run from zero-gains
- 05-01: Portfolio allocation is year-agnostic — shows current open holdings across all tax years
- 05-01: KPI sum uses parseFloat — engine stores precise Decimal strings; float sum adequate for dashboard display
- 05-03: jsdom renders de-DE currency as '€' symbol not 'EUR' text — test assertions use /EUR|€/ regex for portability
- 05-03: gainLossColor returns CSS variable strings (var(--crypto-green/red)) not hex — theming via CSS custom properties
- 05-03: formatEur showSign defaults false; callers pass true for P&L display contexts
- 05-03: ResizeObserver/IntersectionObserver mocks added to shared setup.ts (not per-file) — project-wide availability

- 05-02: Numeric sort uses CAST(col AS REAL) — amount/eurPrice stored as TEXT, lexicographic sort would break ordering
- 05-02: taxImpact computed per-request from lotConsumptions/futuresPositions/earnIncome — no pre-computed column needed
- 05-02: haltefristMet converted via Boolean() — SQLite stores as 0/1 integer in raw queries
- 05-02: TransactionListItem extended with orderId, sourceType, eurPrice for list display badges

- 05-04: Dashboard auto-selects most recent year only when selectedYear equals current calendar year — avoids infinite loop on manual selection
- 05-04: FreigrenzeBar thresholds pct < 70 green, 70-89 amber (#f59e0b), >= 90 red — standard warning UX
- 05-04: recharts Tooltip formatter type: use `(value) => [typeof value === 'number' ? formatEur(value) : ...]` — ValueType is `number | undefined`

- 05-05: MonthlyBarChart losses sign: API returns losses as negative MoneyStrings; Math.abs() applied for stacked bar height
- 05-05: PnlLineChart cumulative: gains + losses (losses already negative) accumulated per month as running sum
- 05-05: SpotFuturesChart bucket lookup: buckets.find(b => b.bucket === 'private_sale') — defensive against API ordering changes
- 05-05: Chart grid wide class: className="chart-card--wide" forwarded through ChartCard to GlassSurface; CSS grid-column: 1/-1

- 05-06: CategoryBadge uses CSS class-based color mapping — enables theming and specificity control
- 05-06: IntersectionObserver on sentinel div for infinite scroll — zero scroll-event listener overhead
- 05-06: AbortController per fetch — prevents stale result race conditions on filter change
- 05-06: availableYears extracted from first page response — avoids separate /api/years endpoint
- 05-06: Import section wrapped in <details> toggle — preserves import functionality without dominating the tab

- 05-07: TransactionDetail returns null when transactionId=null — AnimatePresence exit animation handled by parent (TransactionList)
- 05-07: vi.spyOn(global, 'fetch') preferred over vi.stubGlobal — vi.restoreAllMocks() cleans up spyOn but not stubGlobal
- 05-07: Global cleanup() in setup.ts afterEach — project-wide DOM isolation without per-file boilerplate

- 06-01-a: EarnSummary.totalIncomeEur sourced from SUM(earn_income) not tax_summaries — explicit data lineage
- 06-01-b: freigrenzeStatus computed at generate() time — display concern; DB has taxableAmountEur
- 06-01-c: totalFeesEur in FuturesSummary from futures_positions.fee_eur SUM — tax_summaries has no fee breakdown
- 06-01-d: EarnCoinBreakdown as named interface for typed destructuring in PDF/CSV consumers
- 06-01-e: TradeAppendix sorted by tradedAt ASC then symbol ASC for natural Steuerberater review order

- 06-02-a: createRequire(import.meta.url) for PDFKit — CJS package in ESM backend (standard NodeNext interop)
- 06-02-b: PDF info Keywords field stores section identifiers — body text CID-encoded with TTF; metadata always literal strings
- 06-02-c: DejaVu Sans v2.37 bundled as TTF — SIL OFL, Latin Extended, comprehensive German umlaut coverage
- 06-02-d: sectionHeader/keyValueLine/formatEurPdf exported for plan 06-03 trade appendix reuse

- 06-03-a: TRADE_PAGE_BOTTOM = 770pt — 70pt safety margin above footer; no row clipped
- 06-03-b: formatDateDe uses isoDate.slice(0,10) — timezone-safe ISO date extraction
- 06-03-c: 9-column layout (Symbol/Kaufdatum/Verkaufdatum/Menge/Einstandswert/Erloes/G-V/Tage/Haltefrist) summing to 495pt
- 06-03-d: Tax-free rows use 3pt green left-border accent — compatible with alternating row backgrounds
- 06-03-e: Page count test via /Type /Page(?!s) regex on latin1 buffer — reliable without decompressing streams

- 06-04-a: Dot decimal separator in CSV (not German comma) — CSV is machine-readable import format; Steuerberater software expects standard notation
- 06-04-b: No CSV library — flat structure, manual string building, zero runtime dependencies
- 06-04-c: Summary section after blank separator row — reliable section delimiter for Excel and downstream scripts
- 06-04-d: Steuerfrei column explicit (mirrors Haltefrist erfuellt) — removes ambiguity: legal basis vs tax consequence
- 06-04-e: escapeCsvField exported — independently testable and reusable

- 06-05-a: getReportData helper extracts shared param parsing + ReportGenerator instantiation — avoids duplicating 400/404 logic across 3 year-based routes
- 06-05-b: Buffer converted to ArrayBuffer via .buffer.slice() for Hono c.body() — Hono's Data type is string|ArrayBuffer|ReadableStream|Uint8Array<ArrayBuffer>, not Buffer<ArrayBufferLike>
- 06-05-c: vi.hoisted mockDbRef pattern for TDZ — report-generator.ts exports singleton at module load; vi.hoisted ensures ref object exists before mock factory runs
- 06-05-d: BOM assertion uses raw bytes (0xEF,0xBB,0xBF) — TextDecoder.decode() strips BOM by default

- 06-06-a: YearSelector reused from Dashboard — same component, shared CSS class, no duplication
- 06-06-b: downloading state tracks 'pdf'|'csv'|null — disables both buttons while one downloads
- 06-06-c: yearsLoading gate in preview useEffect — prevents preview fetch before year list resolved
- 06-06-d: FreigrenzeStatus labels use 'eingehalten'/'ueberschritten' — avoids umlaut encoding issues in tests
- 06-06-e: TradeRow as inline component in ReportPreview — 9-column table row, collocated with table for readability

- 06-07-a: Cross-format consistency test uses preview-vs-CSV (not preview-vs-PDF) — PDFKit CID-encodes body text in compressed streams; CSV is uncompressed plain text
- 06-07-b: biome-ignore preferred over eslint-disable for noExplicitAny in newer test files
- 06-07-c: E2E tests target aria-label selectors for PDF/CSV buttons in ReportTab
- 06-07-d: E2E tests use select.year-selector for YearSelector component locator

- 07-01-a: JWT algorithm is HS256 — Hono jwt middleware requires explicit alg parameter (not optional)
- 07-01-b: JWT_SECRET is process.env.JWT_SECRET ?? randomBytes(32).toString('hex') — ephemeral if not set, persists for server lifetime
- 07-01-c: Session cookie has no maxAge (session-only per CONTEXT.md decision)
- 07-01-d: credential_master_key generated and stored at setup time (app_settings) for 07-02 credential encryption
- 07-01-e: Existing route tests unaffected — all create isolated Hono instances, do not import index.ts

- 07-02-a: 12-byte IV (96-bit) for AES-256-GCM — NIST SP 800-38D recommendation; 16-byte salt separate for PBKDF2
- 07-02-b: Fresh random IV + salt per encrypt call — same plaintext produces distinct ciphertexts; no correlation across connections
- 07-02-c: POST /api/exchanges accepts only 'bitget' — other exchanges return 400 until explicitly supported
- 07-02-d: POST /api/exchanges/:id/test stubs ccxt-not-yet-installed — live API call wired in 07-05
- 07-02-e: satisfies operator on Drizzle .returning() — compile-time shape verification without cast/any

- 07-03-a: Static analysis uses regex on fs.readFileSync output rather than AST — sufficient for targeted patterns, zero extra dependencies
- 07-03-b: Console spies use mockImplementation(() => {}) — suppresses test noise while capturing calls for assertion
- 07-03-c: routes/auth.ts included in static analysis alongside auth/*.ts — route handler is where password data flows from request body
- 07-03-d: /api/auth/status key-count assertion (toHaveLength(2)) creates contract preventing future field addition from leaking internal state

- 07-04-a: Auth state machine degrades to login on fetch error — network failure shows login, not permanent block
- 07-04-b: FloatingLines background in all auth states (loading/setup/login) — consistent visual identity from first interaction
- 07-04-c: Settings tab is placeholder — exchange management UI (07-06) will populate it
- 07-04-d: Logout button in Settings tab, not nav bar — avoids destructive action in always-visible navigation
- 07-04-e: SetupCard validation is client-side (>= 8 chars, match) — immediate feedback; backend enforces independently

- 07-05-a: orderId=trade.id (ccxt fill ID) not trade.order (order ID) — each fill is unique; multiple fills share the same order ID
- 07-05-b: Checksum uses trade.id+exchange+sourceType — deterministic dedup key without depending on mutable trade content
- 07-05-c: Promise.allSettled for spot+futures — partial failure imports succeeded side, adds warning for failed side
- 07-05-d: lastSyncAt watermark updated only when at least one side succeeds — prevents watermark advance on total failure
- 07-05-e: import_batches record per sync side (spot/futures) — traceability for API-sourced trades alongside CSV batches

- 07-06-a: Eye toggle uses RevealState record per field — independent per-field visibility without shared state
- 07-06-b: Auto-test on save is best-effort — onSave() fires immediately after POST 201; test result shown as status banner
- 07-06-c: Delete confirmation is inline (replace button with alertdialog) — no modal, no extra component
- 07-06-d: SettingsTab toggle button flips text; CredentialForm also has Abbrechen — both close form; test uses getAllByRole + last match
- 07-06-e: PasswordChange posts to /api/auth/change-password — route placeholder for future plan
- 07-07-a: sanitizeErrorMessage uses /[A-Za-z0-9]{21,}/g — strips credential-like tokens from error responses (21+ char alphanumeric-only)
- 07-07-b: sync-all uses sequential for-loop not Promise.all — avoids rate-limit burst on Bitget API
- 07-07-c: Failed sync-all entry sets exchange=unknown + warnings[] — identifies which connection failed
- 07-07-d: Auto-sync on app mount is fire-and-forget — silent background refresh, no UI feedback
- 07-07-e: sonner Toaster at bottom-right richColors — avoids covering tab navigation

- 09-01-a: createApp() in app.ts imports all routes — index.ts is a pure entry point (serve only)
- 09-01-b: cors({ origin: '*' }) in createApp() — supports both web origins and Electron file:// origins
- 09-01-c: Proxy pattern for db/sqlite exports — lazy init without changing consumer import syntax
- 09-01-d: initDb() throws if called twice (already initialized guard) — prevents accidental double-init
- 09-01-e: Auto-init in ensureInitialized() reads DB_PATH env var — full backward compatibility for tests/dev

- 09-02-b: @vitejs/plugin-react@^5.1.4 (not v6) — v6 requires vite v8, v5.x supports vite v4-8
- 09-02-c: postinstall removed from package.json — electron-builder install-app-deps fails before electron binary installed; moved to explicit rebuild script
- 09-02-d: import.meta.dirname in electron.vite.config.ts — type=module ESM context; __dirname undefined; Node 23 has import.meta.dirname natively
- 09-02-e: ELECTRON_SKIP_BINARY_DOWNLOAD=1 required on Windows with Cylance AV — asar file held by AV during npm reify rename causes EBUSY

- 09-03-a: initDb() called before dynamic import of createApp — DB path injected before any backend module access
- 09-03-b: Dynamic import for @cryptax/backend/app.js in server.ts — defers createApp() until after initDb() completes
- 09-03-c: resolveDbPath/resolveMigrationsPath called inside whenReady callback — app.getPath('userData') requires ready state
- 09-03-d: ELECTRON_RENDERER_URL env var for dev mode — electron-vite sets this automatically; falls back to out/renderer/index.html in prod
- 09-03-e: preload exposes only platform string — renderer uses HTTP fetch to localhost:3001, no IPC channels needed
- 09-03-f: stopBackendServer() in window-all-closed — graceful server shutdown before app.quit()

- 08-01-a: Do not import GlassSurface for sidebar — replicate glass CSS directly; GlassSurface requires fixed width/height props incompatible with 100vh flex column layout
- 08-01-b: Inline SVG icons as named React functions — zero icon library; stroke="currentColor" inherits active/inactive color automatically
- 08-01-c: TabId exported from Sidebar.tsx — canonical source; App.tsx will import from Sidebar in 08-02

- 08-02-a: margin-left approach for content offset — sidebar is position:fixed so content needs margin-left:240px (expanded) / 64px (collapsed); no CSS grid needed
- 08-02-b: TabId imported from Sidebar.tsx, local TabId type removed from App.tsx — single source of truth (established in 08-01-c)
- 08-02-c: content-header__title uses conditional rendering on activeTab — avoids extra mapping state, inline and readable
- 08-02-d: overflow-x moved to html/body (not .app) — .app overflow:hidden clipped fixed sidebar; html/body level prevents horizontal scroll during transition without clipping

- 08-03-a: Dashboard and Report use width:100% with no max-width — data-dense tabs should use all available space beside the 240px sidebar
- 08-03-b: Settings keeps max-width:1000px with margin:0 auto — form-based tabs benefit from a readable line length, increased from 860px to 1000px
- 08-03-c: No test modifications required — all component tests render components in isolation, not through App; CSS container properties are not queried by any test

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7 research flag: ccxt Bitget v2 deep history pagination is untested
- German tax law: Haltefrist exact day count — RESOLVED: using 366 days (conservative interpretation per 04-01)
- Migration workflow: After `npm run db:generate`, manually add STRICT to new CREATE TABLE statements

### Roadmap Evolution

- Phase 9 added (2026-03-27): Electron Desktop App — transform web app into native desktop application with identical design and functionality
- 09-02 Windows AV note: Cylance holds default_app.asar during npm install; always use ELECTRON_SKIP_BINARY_DOWNLOAD=1 for npm install on this machine. Run `node node_modules/electron/install.js` separately to get real binary before packaging.

## Session Continuity

Last session: 2026-03-27T11:03:41Z
Stopped at: Completed 09-03-PLAN.md — Electron main process, preload, db-path, server modules
Resume file: None
