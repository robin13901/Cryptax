# Architecture Patterns

**Domain:** Local crypto tax reporting tool (German tax law)
**Project:** Cryptax — Vite 8 + React 19 frontend, Node.js + SQLite backend
**Researched:** 2026-03-21
**Overall confidence:** HIGH for structural decisions, MEDIUM for German tax law specifics (no official source was fetchable; relies on training data cross-checked against project context)

---

## 1. Frontend-Backend Separation

### Decision: Monorepo with Vite Dev Proxy

**Recommendation:** npm workspaces monorepo with Vite's `server.proxy` for development, static file serving for production.

**Rationale for this project:**
- The frontend already exists as a standalone Vite app. The backend is new. Monorepo lets both live in the same git repo with shared TypeScript types without rewriting anything.
- Vite's `server.proxy` is confirmed available (verified via official Vite docs). It proxies `/api/*` to `http://localhost:3001` during `vite dev`. No CORS configuration needed in development.
- For production (local tool, not deployed), the Express server can serve the Vite `dist/` as static files from one process. Single `node server.js` launches everything.
- A separate server approach (no monorepo, no proxy) would require CORS headers and two separate startup commands — unnecessary friction for a local tool.

**Directory layout:**

```
Cryptax/
  package.json              # root: workspaces config + shared scripts
  packages/
    frontend/               # current dashboard/ renamed/moved here
      package.json
      vite.config.ts        # adds server.proxy: { '/api': 'http://localhost:3001' }
      src/
    backend/
      package.json
      src/
        index.ts            # Express server entry
        db/
        routes/
        services/
        engine/
    shared/
      package.json
      src/
        types/              # Transaction, TaxLot, TaxResult interfaces
                            # consumed by both frontend (via import) and backend
```

**Root package.json workspaces:**
```json
{
  "name": "cryptax",
  "private": true,
  "workspaces": ["packages/frontend", "packages/backend", "packages/shared"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w frontend\" \"npm run dev -w backend\"",
    "build": "npm run build -w shared && npm run build -w backend && npm run build -w frontend",
    "test": "npm test -w backend -w shared"
  }
}
```

**Vite proxy (packages/frontend/vite.config.ts addition):**
```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
},
```

**Production serving (packages/backend/src/index.ts):**
```typescript
// Serve Vite build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (_, res) => res.sendFile(
    path.join(__dirname, '../../frontend/dist/index.html')
  ));
}
```

**Alternatives rejected:**

| Option | Why Rejected |
|--------|--------------|
| Separate repos | Two git repos, extra overhead, no shared types |
| Electron | Overkill for a local web tool; adds 150MB binary, packaging complexity |
| Next.js full-stack | Would require rewriting existing Vite/React frontend entirely |
| Turborepo/Nx | Adds tooling complexity that npm workspaces handles adequately at this scale |

---

## 2. SQLite Schema Design

### Design Principles
- Store raw imported data unchanged (audit trail)
- Normalized unified transactions are separate from raw imports
- FIFO lots are materialized (computed once, stored), not recalculated on every query
- All monetary values stored as TEXT with Decimal precision, not REAL (avoids IEEE 754 drift)
- All timestamps stored as ISO 8601 UTC strings (SQLite has no native datetime type)
- Tax years are rows, not columns (supports multi-year easily)

### Schema Draft

```sql
-- ============================================================
-- RAW IMPORT LAYER (audit trail, never mutated after import)
-- ============================================================

CREATE TABLE import_batches (
  id          INTEGER PRIMARY KEY,
  imported_at TEXT    NOT NULL,          -- ISO 8601 UTC
  source_file TEXT    NOT NULL,          -- original filename
  format      TEXT    NOT NULL,          -- 'spot_tx' | 'futures_tx' | 'spot_orders' | 'futures_orders' | 'earn'
  row_count   INTEGER NOT NULL,
  checksum    TEXT    NOT NULL UNIQUE    -- SHA256 of file content; prevents duplicate imports
);

CREATE TABLE raw_rows (
  id           INTEGER PRIMARY KEY,
  batch_id     INTEGER NOT NULL REFERENCES import_batches(id),
  line_number  INTEGER NOT NULL,
  raw_json     TEXT    NOT NULL          -- original CSV row as JSON object
);

-- ============================================================
-- UNIFIED TRANSACTION LAYER (normalized from raw)
-- ============================================================

-- canonical_type covers all transaction semantics in this system
-- Spot: buy | sell | deposit | withdrawal | fee | dust_conversion
-- Futures: open_long | close_long | open_short | close_short |
--          funding_fee | settlement_fee | realized_pnl
-- Earn: staking_deposit | staking_reward | staking_withdrawal
CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY,
  raw_row_id      INTEGER REFERENCES raw_rows(id),  -- traceability
  external_id     TEXT    NOT NULL,                  -- exchange order/ref ID
  source          TEXT    NOT NULL DEFAULT 'bitget', -- exchange name
  account_type    TEXT    NOT NULL,                  -- 'spot' | 'futures' | 'earn'
  canonical_type  TEXT    NOT NULL,                  -- see above
  executed_at     TEXT    NOT NULL,                  -- ISO 8601 UTC
  base_asset      TEXT,                              -- e.g. 'BTC' (NULL for futures P&L)
  quote_asset     TEXT,                              -- e.g. 'EUR', 'USDT'
  amount          TEXT    NOT NULL DEFAULT '0',      -- decimal string, positive
  price_quote     TEXT,                              -- price in quote_asset at execution
  price_eur       TEXT,                              -- EUR price at execution (enriched)
  fee_asset       TEXT,
  fee_amount      TEXT    NOT NULL DEFAULT '0',
  fee_eur         TEXT,
  futures_symbol  TEXT,                              -- e.g. 'POPCATUSDT' (futures only)
  margin_mode     TEXT,                              -- 'Single-asset' | 'Cross' (futures)
  wallet_balance  TEXT,                              -- snapshot from Bitget (futures)
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tx_executed_at    ON transactions(executed_at);
CREATE INDEX idx_tx_base_asset     ON transactions(base_asset);
CREATE INDEX idx_tx_account_type   ON transactions(account_type);
CREATE INDEX idx_tx_canonical_type ON transactions(canonical_type);

-- ============================================================
-- PRICE CACHE (historical EUR prices, populated lazily)
-- ============================================================

CREATE TABLE price_cache (
  id          INTEGER PRIMARY KEY,
  coin        TEXT NOT NULL,
  ts_minute   TEXT NOT NULL,   -- ISO 8601 truncated to minute: '2024-12-31T17:00:00Z'
  price_eur   TEXT NOT NULL,   -- decimal string
  source      TEXT NOT NULL,   -- 'bitget_direct' | 'bitget_usdt_converted'
  fetched_at  TEXT NOT NULL,
  UNIQUE (coin, ts_minute)
);

CREATE INDEX idx_price_coin_ts ON price_cache(coin, ts_minute);

-- ============================================================
-- FIFO ENGINE LAYER (materialized cost basis lots)
-- ============================================================

-- A lot is created when you acquire an asset (buy, staking reward, etc.)
-- It is consumed (partially or fully) when you dispose of that asset.
-- Cross-year lots are handled naturally: a lot created in 2024 can be
-- consumed in 2025 — the holding_days span the gap.

CREATE TABLE fifo_lots (
  id              INTEGER PRIMARY KEY,
  asset           TEXT NOT NULL,               -- e.g. 'BTC'
  account_type    TEXT NOT NULL,               -- 'spot' | 'earn'
  acquisition_tx  INTEGER NOT NULL REFERENCES transactions(id),
  acquired_at     TEXT NOT NULL,               -- copy of tx.executed_at (indexed)
  original_amount TEXT NOT NULL,               -- decimal string
  remaining       TEXT NOT NULL,               -- decimal string; reduced on each disposal
  cost_basis_eur  TEXT NOT NULL,               -- total EUR cost for original_amount
  cost_per_unit   TEXT NOT NULL,               -- cost_basis_eur / original_amount
  status          TEXT NOT NULL DEFAULT 'open' -- 'open' | 'partial' | 'closed'
);

CREATE INDEX idx_lot_asset_status   ON fifo_lots(asset, status);
CREATE INDEX idx_lot_acquired_at    ON fifo_lots(acquired_at);

-- Each row records how a lot was consumed
CREATE TABLE lot_consumptions (
  id              INTEGER PRIMARY KEY,
  lot_id          INTEGER NOT NULL REFERENCES fifo_lots(id),
  disposal_tx     INTEGER NOT NULL REFERENCES transactions(id),
  disposed_at     TEXT    NOT NULL,
  amount_consumed TEXT    NOT NULL,             -- decimal string
  proceeds_eur    TEXT    NOT NULL,             -- revenue for this slice
  cost_eur        TEXT    NOT NULL,             -- cost for this slice (from lot)
  gain_eur        TEXT    NOT NULL,             -- proceeds - cost (can be negative)
  holding_days    INTEGER NOT NULL,             -- disposed_at - acquired_at in full days
  is_tax_free     INTEGER NOT NULL DEFAULT 0,  -- 1 if holding_days >= 365 (Haltefrist)
  tax_year        INTEGER NOT NULL             -- extracted from disposed_at
);

CREATE INDEX idx_consumption_tax_year  ON lot_consumptions(tax_year);
CREATE INDEX idx_consumption_lot_id    ON lot_consumptions(lot_id);
CREATE INDEX idx_consumption_disposed  ON lot_consumptions(disposed_at);

-- ============================================================
-- FUTURES P&L LAYER (separate from FIFO — no holding period applies)
-- ============================================================

-- Futures are capital gains (Abgeltungssteuer), not private Veräußerungsgeschäfte.
-- No holding period. P&L is: realized_pnl - all_fees for the position.
-- Each closed position is one row.

CREATE TABLE futures_positions (
  id              INTEGER PRIMARY KEY,
  symbol          TEXT    NOT NULL,   -- e.g. 'POPCATUSDT'
  direction       TEXT    NOT NULL,   -- 'long' | 'short'
  opened_at       TEXT    NOT NULL,
  closed_at       TEXT,               -- NULL = still open
  entry_price     TEXT,
  exit_price      TEXT,
  size            TEXT    NOT NULL,
  realized_pnl    TEXT    NOT NULL DEFAULT '0',  -- from Bitget
  total_fees      TEXT    NOT NULL DEFAULT '0',
  net_pnl_usdt    TEXT    NOT NULL DEFAULT '0',  -- realized_pnl - total_fees
  net_pnl_eur     TEXT,                           -- converted at close time
  tax_year        INTEGER
);

-- Funding/settlement fees aggregated per position
CREATE TABLE futures_fees (
  id              INTEGER PRIMARY KEY,
  position_id     INTEGER REFERENCES futures_positions(id),
  tx_id           INTEGER NOT NULL REFERENCES transactions(id),
  fee_amount_usdt TEXT    NOT NULL,
  fee_eur         TEXT,
  fee_type        TEXT    NOT NULL   -- 'funding_fee' | 'settlement_fee' | 'open_fee' | 'close_fee'
);

-- ============================================================
-- EARN / STAKING LAYER
-- ============================================================

-- Staking/earn income: taxed as "sonstige Einkünfte" at personal tax rate
-- (not Abgeltungssteuer, not §23 EStG) when received.
-- The received coins become new lots with cost basis = market value at receipt.

CREATE TABLE earn_income (
  id              INTEGER PRIMARY KEY,
  tx_id           INTEGER NOT NULL REFERENCES transactions(id),
  reference_id    TEXT    NOT NULL,   -- Bitget Reference field
  coin            TEXT    NOT NULL,
  earn_type       TEXT    NOT NULL,   -- 'staking_reward' | 'interest' | 'deposit' | 'withdrawal'
  amount          TEXT    NOT NULL,
  income_eur      TEXT,               -- amount * price_eur at receipt
  received_at     TEXT    NOT NULL,
  tax_year        INTEGER NOT NULL
);

-- ============================================================
-- TAX SUMMARY LAYER (pre-computed per year, invalidated on re-run)
-- ============================================================

CREATE TABLE tax_summaries (
  id                          INTEGER PRIMARY KEY,
  tax_year                    INTEGER NOT NULL UNIQUE,
  computed_at                 TEXT    NOT NULL,

  -- §23 EStG: Spot FIFO gains/losses (Haltefrist applies)
  spot_taxable_gains_eur      TEXT    NOT NULL DEFAULT '0',
  spot_taxable_losses_eur     TEXT    NOT NULL DEFAULT '0',
  spot_net_eur                TEXT    NOT NULL DEFAULT '0',
  spot_tax_free_gains_eur     TEXT    NOT NULL DEFAULT '0',  -- held > 1 year

  -- Abgeltungssteuer: Futures net P&L
  futures_net_pnl_eur         TEXT    NOT NULL DEFAULT '0',
  futures_abgeltungssteuer    TEXT    NOT NULL DEFAULT '0',  -- 25% + Soli

  -- Sonstige Einkünfte: Earn/Staking
  earn_total_income_eur       TEXT    NOT NULL DEFAULT '0',

  -- Meta
  freigrenze_600_applies      INTEGER NOT NULL DEFAULT 0,    -- 1 if spot_net < 600 EUR
  notes                       TEXT
);
```

### Schema Decisions Explained

| Decision | Rationale |
|----------|-----------|
| Amounts as TEXT (not REAL) | SQLite REAL is IEEE 754 binary float. 0.1 + 0.2 ≠ 0.3. Tax calculations must be exact. Store as decimal strings, compute with Decimal.js. |
| raw_rows / import_batches | Full audit trail. If the FIFO engine has a bug, raw data can be reprocessed without re-importing from files. |
| checksum on import_batches | Prevents duplicate CSV imports producing double-counted transactions. |
| fifo_lots + lot_consumptions separate | Lots are "open positions." Consumptions are "disposal events." This models partial disposals cleanly (one lot can have many consumption rows). |
| futures_positions separate from FIFO | Futures are not private Veräußerungsgeschäfte under German law — they are capital gains (Abgeltungssteuer). Different tax treatment requires different model. |
| earn_income separate | Earn/staking income is "sonstige Einkünfte" taxed at personal rate, not Abgeltungssteuer and not §23 EStG. Third tax bucket. |
| tax_summaries materialized | Computing FIFO across 3,400 rows is fast (~10ms) but a React component should not trigger it on every render. Compute once, cache, invalidate on import. |

---

## 3. FIFO Engine Architecture

### German Tax Law Context (MEDIUM confidence — training data, no official source fetched)

German crypto taxation has three separate regimes:

| Regime | Applies To | Tax Rate | Holding Period |
|--------|------------|----------|----------------|
| §23 EStG (privates Veräußerungsgeschäft) | Spot BTC/ETH/etc. buys and sells | Personal income tax rate | Gain is tax-free if asset held > 365 days (Haltefrist) |
| §20 EStG (Abgeltungssteuer) | Futures / derivatives / leveraged products | 25% + 5.5% Soli = ~26.375% | No holding period — 100% taxable regardless of duration |
| Sonstige Einkünfte §22 Nr. 3 EStG | Staking rewards, earn interest | Personal income tax rate | No holding period — taxed at receipt as income |

**FIFO under §23 EStG:**
- Oldest lots consumed first (strict FIFO per coin, not per account)
- Each coin tracked independently (BTC queue, ETH queue, SOL queue, etc.)
- Partial lot consumption allowed
- Tax-free if total disposal quantity × holding check: each unit's specific holding days >= 365
- Cross-year lots work naturally: a BTC lot acquired Dec 2023 disposed Jan 2025 = ~395 days = tax-free

### Engine Component Structure

```
packages/backend/src/engine/
  fifo/
    FifoEngine.ts          # orchestrates lot creation and consumption
    LotManager.ts          # CRUD for fifo_lots table
    ConsumptionRecorder.ts # writes lot_consumptions, enforces FIFO order
    HaltefristChecker.ts   # determines is_tax_free based on holding_days
  futures/
    FuturesPnlEngine.ts    # aggregates futures P&L per position
    FuturesFeeAggregator.ts
  earn/
    EarnIncomeEngine.ts    # records earn income, creates acquisition lots
  TaxCalculator.ts         # entry point: calls all engines, writes tax_summaries
  types.ts                 # TaxResult, FifoLot, Consumption, etc.
```

### FifoEngine Internal Algorithm

```typescript
// Pseudocode — not production code
class FifoEngine {
  processDisposal(db: Database, tx: Transaction): void {
    // 1. Find all open/partial lots for tx.base_asset in FIFO order
    const lots = db.prepare(`
      SELECT * FROM fifo_lots
      WHERE asset = ? AND status != 'closed'
      ORDER BY acquired_at ASC, id ASC
    `).all(tx.base_asset);

    let remaining = new Decimal(tx.amount);
    const proceeds_per_unit = new Decimal(tx.price_eur!);

    for (const lot of lots) {
      if (remaining.lte(0)) break;

      const lotRemaining = new Decimal(lot.remaining);
      const consumed = Decimal.min(lotRemaining, remaining);
      const cost_slice = consumed.mul(lot.cost_per_unit);
      const proceeds_slice = consumed.mul(proceeds_per_unit);
      const gain = proceeds_slice.minus(cost_slice);
      const holding_days = dateDiffDays(lot.acquired_at, tx.executed_at);

      db.transaction(() => {
        // Record consumption
        insertConsumption({
          lot_id: lot.id,
          disposal_tx: tx.id,
          amount_consumed: consumed.toString(),
          proceeds_eur: proceeds_slice.toString(),
          cost_eur: cost_slice.toString(),
          gain_eur: gain.toString(),
          holding_days,
          is_tax_free: holding_days >= 365 ? 1 : 0,
          tax_year: getYear(tx.executed_at),
        });

        // Update lot remaining
        const newRemaining = lotRemaining.minus(consumed);
        updateLotStatus(lot.id, newRemaining);
      })();

      remaining = remaining.minus(consumed);
    }

    if (remaining.gt(0)) {
      // Negative lot / short sell — flag for manual review
      // This can happen with incomplete data (missing earlier imports)
      recordDataGap(tx.id, remaining.toString());
    }
  }
}
```

### Critical Engine Properties

**Decimal precision:** Use `decimal.js` for all arithmetic. Store as TEXT in SQLite. Never use JavaScript `number` for monetary values.

**Transaction atomicity:** Wrap each disposal's lot updates + consumption inserts in a single `better-sqlite3` transaction. If anything fails, no partial state persists.

**Idempotent re-runs:** Before re-running the FIFO engine, truncate `fifo_lots`, `lot_consumptions`, `futures_positions`, `earn_income`, `tax_summaries`. Re-derive everything from `transactions`. This makes the engine stateless and safe to rerun after bug fixes.

**Ordering invariant:** FIFO order requires `acquired_at ASC, id ASC`. The `id ASC` tiebreaker handles two lots with the same timestamp (possible with batch imports).

**Negative balances:** If a disposal exceeds available lots, record a data gap rather than crashing. This surfaces incomplete import data without corrupting the database.

---

## 4. Data Pipeline

### Pipeline Stages

```
CSV File
  │
  ▼
[Stage 1: Format Detection]
  Detect which of the 5 formats by column headers.
  Return: FormatType enum + delimiter.
  │
  ▼
[Stage 2: Raw Storage]
  Insert into import_batches (checksum check first).
  Insert each row into raw_rows as JSON.
  Rollback everything if checksum collision.
  │
  ▼
[Stage 3: Normalization]
  Format-specific parser maps each raw_row to a transactions row.
  Each parser is a pure function: RawRow → TransactionInsert | ParseError.
  Insert all transactions atomically.
  │
  ▼
[Stage 4: Price Enrichment]
  For each transaction missing price_eur:
    1. Check price_cache for coin + ts_minute.
    2. If cache miss: call Bitget spot candle API.
       Strategy: direct COINEUR → fallback COINUSDT × USDTEUR.
    3. Write to price_cache.
    4. Update transactions.price_eur, transactions.fee_eur.
  Run incrementally: only enrich rows where price_eur IS NULL.
  │
  ▼
[Stage 5: FIFO Engine]
  Process all transactions in chronological order (executed_at ASC).
  Create lots for acquisitions.
  Consume lots for disposals.
  Aggregate futures P&L.
  Record earn income.
  Write tax_summaries.
  │
  ▼
[Stage 6: Report Generation]
  Read tax_summaries + detailed lot_consumptions for chosen year.
  Format for PDF via pdfkit or puppeteer-rendered HTML.
  Return to frontend for download.
```

### Component File Mapping

```
packages/backend/src/
  routes/
    import.ts         # POST /api/import — Stage 1-3
    prices.ts         # POST /api/prices/enrich — Stage 4
    engine.ts         # POST /api/engine/run — Stage 5
    report.ts         # GET /api/report/:year — Stage 6
    transactions.ts   # GET /api/transactions (paginated)
    summary.ts        # GET /api/summary/:year
  services/
    formatDetector.ts # Stage 1: detects CSV format from headers
    parsers/
      SpotTxParser.ts          # spot transactions (semicolon format)
      FuturesTxParser.ts       # futures transactions (comma format)
      SpotOrderParser.ts       # spot order history
      FuturesOrderParser.ts    # futures order history
      EarnParser.ts            # on-chain earn
    PriceEnricher.ts   # Stage 4: cache-first price lookup
    BitgetPriceClient.ts       # Bitget candle API calls
    ReportGenerator.ts # Stage 6: builds PDF data
  db/
    schema.ts         # CREATE TABLE statements (run on startup)
    migrations.ts     # version-based schema migrations
    Database.ts       # singleton better-sqlite3 instance
```

### Format Detection Logic

```typescript
type CsvFormat =
  | 'spot_tx'           // order;Date;Coin;Type;Amount;Fee;Available
  | 'futures_tx'        // Order,Date,Coin,Futures,Margin Mode,...
  | 'spot_orders'       // Date,Type,Order Id,Trading pair,...
  | 'futures_orders'    // Date,Order ID,Direction,Coin,Futures,...
  | 'earn'              // Reference,Start time,Coin,Type,Interest coin,...

function detectFormat(headers: string[]): CsvFormat {
  // Unique discriminating columns:
  if (headers.includes('Reference') && headers.includes('Interest coin')) return 'earn';
  if (headers.includes('Trading pair') && headers.includes('Base Asset')) return 'spot_orders';
  if (headers.includes('Futures') && headers.includes('Direction') && headers.includes('Realized P/L')) return 'futures_orders';
  if (headers.includes('Futures') && headers.includes('Margin Mode')) return 'futures_tx';
  if (headers.includes('Available')) return 'spot_tx';
  throw new Error(`Unknown CSV format. Headers: ${headers.join(', ')}`);
}
```

---

## 5. Exchange API Abstraction Layer

### Recommendation: Thin Adapter Pattern, Not ccxt (yet)

**Decision:** Build a minimal adapter interface first. Add ccxt as an optional secondary adapter layer when additional exchanges are required.

**Rationale:**
- The only exchange currently used is Bitget, and the Bitget API is already understood from the Python reference script.
- ccxt adds ~5MB and 100+ exchange adapters when only Bitget is needed. It also normalizes data in ways that may not match Bitget's specific transaction types.
- The adapter pattern means ccxt can be added in a later phase without changing the engine.

**Adapter Interface:**

```typescript
// packages/shared/src/types/ExchangeAdapter.ts
interface ExchangeAdapter {
  name: string;

  // For CSV import: parse exchange-specific CSV rows
  detectFormat(headers: string[]): CsvFormat | null;
  parseRow(row: Record<string, string>, format: CsvFormat): TransactionInsert;

  // For API import (future): fetch historical trades
  fetchTrades?(since: Date, until: Date): Promise<TransactionInsert[]>;

  // For price enrichment: get historical price in EUR
  getHistoricalPriceEur(coin: string, at: Date): Promise<number | null>;
}
```

**AdapterRegistry:**

```typescript
// packages/backend/src/services/AdapterRegistry.ts
class AdapterRegistry {
  private adapters = new Map<string, ExchangeAdapter>();

  register(adapter: ExchangeAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  forExchange(name: string): ExchangeAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`No adapter registered for ${name}`);
    return adapter;
  }

  detectExchange(headers: string[]): ExchangeAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.detectFormat(headers) !== null) return adapter;
    }
    return null;
  }
}
```

**BitgetAdapter** implements this interface directly using the Bitget API (as already understood from `get_eur_prices_bitget.py`).

**When to add ccxt:** When a second exchange needs to be supported. At that point, wrap ccxt's unified trade format behind the `ExchangeAdapter` interface — the engine never sees ccxt types directly.

---

## 6. Credential Storage Architecture

### Threat Model

This is a local tool running on the user's own machine. The threat model is:
- Protection against accidentally committing API keys to git
- Protection against other users on the same machine (optional)
- NOT protection against an attacker with access to the running machine (that's outside scope)

### Decision: AES-256-GCM encrypted file + OS-derived key

**Implementation approach:**

```
packages/backend/
  data/
    .gitignore           # data/ is git-ignored entirely
    cryptax.db           # SQLite database
    credentials.enc      # encrypted API credentials
```

**Key derivation:** Use a machine-specific identifier (OS hostname + user account name + a static salt baked into the app) as input to `crypto.scrypt()` to derive the encryption key. This means:
- Credentials cannot be decrypted on a different machine
- No master password prompt needed (frictionless for a personal tool)
- Still not stored plaintext in git

**Alternative if stronger security is desired:** Use `keytar` (wraps Windows Credential Manager / macOS Keychain / Linux Secret Service). Keytar uses the OS secure storage APIs. This is the right choice if the tool eventually runs on shared machines.

```typescript
// packages/backend/src/services/CredentialStore.ts
interface ExchangeCredentials {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;  // Bitget requires passphrase
}

class CredentialStore {
  private deriveKey(): Buffer { /* scrypt from machine ID */ }
  save(creds: ExchangeCredentials): void { /* AES-256-GCM encrypt to file */ }
  load(exchange: string): ExchangeCredentials | null { /* decrypt */ }
  list(): string[] { /* return exchange names only */ }
}
```

**Gitignore for data directory:**
```
packages/backend/data/
```

---

## 7. Testing Architecture

### Testing Strategy for Financial Calculations

Financial code requires three complementary test types:

**Type 1: Known Tax Scenarios (Golden Master Tests)**

The most important. Define 10-20 complete scenarios with known correct answers. These serve as regression tests and documentation.

```typescript
// packages/backend/src/__tests__/fifo/scenarios/spot_with_haltefrist.test.ts
describe('FIFO: Spot disposal after Haltefrist', () => {
  it('gain is tax-free when holding period >= 365 days', () => {
    // Arrange: buy 1 BTC on 2024-01-01 for 30,000 EUR
    //          sell 1 BTC on 2025-01-15 for 40,000 EUR
    //          holding = 379 days >= 365 → tax-free
    const result = runFifoEngine(db, scenarioBitcoinHaltefrist);
    expect(result.spot_tax_free_gains_eur).toBe('10000.00');
    expect(result.spot_taxable_gains_eur).toBe('0.00');
  });
});

describe('FIFO: Partial lot consumption', () => {
  it('correctly consumes oldest lot first across multiple purchases', () => {
    // buy 2 BTC for 30k on day 0
    // buy 1 BTC for 35k on day 100
    // sell 1.5 BTC on day 400
    // → 1.5 units from first lot (held 400 days → tax-free)
    // FIFO consumes 1.5 from first lot, leaves 0.5 in first lot
    const lots = getLots(db, 'BTC');
    expect(lots[0].remaining).toBe('0.50000000');
    expect(lots[0].status).toBe('partial');
  });
});
```

**Type 2: Property-Based Tests (fast-check for invariants)**

Use `fast-check` for mathematical invariants that must hold for all inputs.

```typescript
import fc from 'fast-check';

describe('FIFO invariants', () => {
  it('total consumed never exceeds total acquired for any coin', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryAcquisition()),
        fc.array(arbitraryDisposal()),
        (acquisitions, disposals) => {
          const db = createTestDb();
          const sortedTxs = [...acquisitions, ...disposals]
            .sort((a, b) => a.executed_at.localeCompare(b.executed_at));
          runFifoEngine(db, sortedTxs);
          const consumed = getTotalConsumed(db, 'BTC');
          const acquired = getTotalAcquired(db, 'BTC');
          return consumed.lte(acquired);
        }
      )
    );
  });

  it('sum of lot_consumptions.gain_eur equals proceeds minus cost', () => {
    fc.assert(
      fc.property(
        arbitraryCompleteFifoScenario(),
        (scenario) => {
          const result = runFifoEngine(scenario);
          // proceeds - cost = gain must hold for every consumption row
          return result.consumptions.every(c =>
            new Decimal(c.proceeds_eur).minus(c.cost_eur).eq(c.gain_eur)
          );
        }
      )
    );
  });
});
```

**Type 3: Unit Tests for Parsers (each CSV format)**

```typescript
describe('SpotTxParser', () => {
  it('parses semicolon-separated spot transaction row', () => {
    const raw = '1258113040865390595;2024-12-31 23:17:21;USDE;Interest;0.00067825;0;0.61142511';
    const result = parseSpotTxRow(raw);
    expect(result.external_id).toBe('1258113040865390595');
    expect(result.canonical_type).toBe('staking_reward');
    expect(result.amount).toBe('0.00067825');
    expect(result.base_asset).toBe('USDE');
  });

  it('handles BOM character in first row', () => {
    const rowWithBom = '\uFEFF1234;2024-01-01 00:00:00;BTC;buy;1;0;1';
    expect(() => parseSpotTxRow(rowWithBom)).not.toThrow();
  });
});
```

**Test Infrastructure:**

```
packages/backend/src/__tests__/
  helpers/
    testDb.ts           # createInMemoryDb() + runMigrations()
    fifoHelpers.ts      # runFifoEngine(db, txs), createTestLot(), etc.
    arbitraries.ts      # fast-check arbitraries for domain types
    taxScenarios.ts     # 10-20 complete known-answer tax scenarios
  unit/
    parsers/
      SpotTxParser.test.ts
      FuturesTxParser.test.ts
      EarnParser.test.ts
      formatDetector.test.ts
    fifo/
      FifoEngine.test.ts          # integration with in-memory SQLite
      HaltefristChecker.test.ts
      scenarios/                  # golden master tests
  property/
    fifoInvariants.test.ts
    decimalPrecision.test.ts
  api/
    import.test.ts      # supertest HTTP tests for import route
    report.test.ts
```

**Test runner:** Vitest (verified: supports Vite ecosystem, Node.js, TypeScript, requires Vite >= 6 and Node >= 20 — both satisfied by this project's stack).

**Key testing rule:** All FIFO engine functions take a `Database` instance as parameter (dependency injection). Tests pass an in-memory `better-sqlite3` database (`:memory:`). No file I/O in tests.

---

## 8. Build Order / Dependency Graph

### Phase Dependencies

```
Phase 1: Foundation
  ├─ Monorepo setup (workspaces, shared types)
  ├─ SQLite schema + migrations
  ├─ Database singleton (better-sqlite3)
  └─ Express server skeleton with health check
        ENABLES → all other phases

Phase 2: CSV Import Pipeline
  ├─ REQUIRES: Phase 1 (db schema)
  ├─ formatDetector
  ├─ 5 parsers (one per CSV format)
  ├─ importBatches + rawRows + transactions insert
  ├─ Import route (POST /api/import with multer)
  └─ Frontend: upload UI component
        ENABLES → Phase 3, 4

Phase 3: Price Enrichment
  ├─ REQUIRES: Phase 2 (transactions exist)
  ├─ BitgetPriceClient (port Python logic to TypeScript)
  ├─ price_cache table + cache-first lookup
  ├─ PriceEnricher service
  └─ Enrichment route (POST /api/prices/enrich)
        ENABLES → Phase 4 (FIFO requires EUR prices)

Phase 4: FIFO Engine
  ├─ REQUIRES: Phase 3 (price_eur populated)
  ├─ LotManager (create lots from acquisitions)
  ├─ ConsumptionRecorder (consume lots for disposals)
  ├─ HaltefristChecker
  ├─ FuturesPnlEngine
  ├─ EarnIncomeEngine
  ├─ TaxCalculator (orchestrates all, writes tax_summaries)
  └─ Engine route (POST /api/engine/run)
        ENABLES → Phase 5

Phase 5: Dashboard + Report UI
  ├─ REQUIRES: Phase 4 (tax_summaries exist)
  ├─ Summary API (GET /api/summary/:year)
  ├─ Transactions API (GET /api/transactions with pagination)
  ├─ React: KPI cards wired to real data
  ├─ React: Transactions table
  └─ React: Steuerreport page with breakdown

Phase 6: PDF Export
  ├─ REQUIRES: Phase 5 (report data structures defined)
  ├─ ReportGenerator service
  ├─ PDF library (pdfkit or puppeteer)
  └─ Report route (GET /api/report/:year/pdf)

Phase 7: Exchange API Integration (deferred, optional)
  ├─ REQUIRES: Phase 1-2 (adapter interface + import pipeline)
  ├─ Bitget REST API adapter (fetchTrades, fetchOrders)
  ├─ ccxt wrapper (if second exchange needed)
  └─ Credential store + exchange settings UI
```

### Critical Path

```
Foundation → CSV Import → Price Enrichment → FIFO Engine → Dashboard
```

Every phase has exactly one upstream dependency. No circular dependencies. Phases 1-4 are pure backend with no UI. UI work starts in Phase 5 when there is real data to display.

**Why this order matters:**
- The FIFO engine cannot run without EUR prices (Phase 3 before 4)
- EUR prices cannot be enriched without transactions (Phase 2 before 3)
- A dashboard showing "--" (current state) can be shipped at any phase — UI is not blocked, but it shows no real data until Phase 5
- PDF export depends on knowing what the report structure is (Phase 5 before 6)

---

## Component Boundary Map

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  (packages/frontend)                              │
│  React 19 + Vite 8 + Recharts                               │
│  Communicates only via /api/* HTTP (JSON)                   │
│  No SQLite, no file system, no engine logic                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / JSON  (dev: Vite proxy)
                       │              (prod: Express static)
┌──────────────────────▼──────────────────────────────────────┐
│  BACKEND API  (packages/backend/src/routes/)                │
│  Express.js — thin HTTP layer                               │
│  Delegates to services, never contains business logic       │
└──────┬──────────┬──────────────┬──────────────┬────────────┘
       │          │              │              │
┌──────▼───┐ ┌───▼────┐  ┌──────▼──────┐ ┌────▼──────────┐
│ Parsers  │ │ Price  │  │ FIFO Engine │ │  Report       │
│ (5 CSV   │ │Enricher│  │(+Futures+   │ │  Generator    │
│  formats)│ │        │  │  Earn)      │ │               │
└──────┬───┘ └───┬────┘  └──────┬──────┘ └────┬──────────┘
       │         │              │              │
┌──────▼─────────▼──────────────▼──────────────▼────────────┐
│  DATABASE LAYER  (packages/backend/src/db/)                │
│  better-sqlite3 — synchronous SQLite                       │
│  All monetary values as TEXT (Decimal.js for computation)  │
│  Tables: import_batches, raw_rows, transactions,           │
│          price_cache, fifo_lots, lot_consumptions,         │
│          futures_positions, futures_fees,                   │
│          earn_income, tax_summaries                        │
└────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SHARED  (packages/shared/src/types/)                       │
│  TypeScript interfaces shared by frontend and backend       │
│  Transaction, FifoLot, TaxSummary, ExchangeAdapter          │
│  No runtime logic — types only                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  EXTERNAL  (Bitget API)                                     │
│  Only accessed by BitgetPriceClient and (future)            │
│  BitgetAdapter.fetchTrades()                                │
│  All calls go through adapter interface                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Floating-Point Arithmetic for Money
**What:** Using JavaScript `number` for tax calculations.
**Why bad:** `0.1 + 0.2 === 0.30000000000000004`. Gain calculations will be wrong by fractions of cents, which accumulate.
**Instead:** Decimal.js for all computation. TEXT storage in SQLite. Convert to number only for display.

### Anti-Pattern 2: Stateful FIFO Engine
**What:** Running the engine incrementally, updating only affected lots when a new import arrives.
**Why bad:** Import order bugs, partial state corruptions, makes regression testing nearly impossible.
**Instead:** Re-run the entire engine from `transactions` table on every recalculation. With 3,400 rows, this takes < 100ms. Materialize results into `tax_summaries`.

### Anti-Pattern 3: Parsing Bitget CSVs with Generic Libraries Alone
**What:** Using `csv-parse` generic options and hoping column names are consistent.
**Why bad:** Bitget exports have BOM characters, inconsistent delimiters (semicolons for spot_tx, commas for futures_tx), trailing spaces in IDs (`\t1252628755719299080`), and the same "Coin" column meaning different things per format.
**Instead:** One dedicated parser per format. Format detected by header signature. BOM stripped on parse. ID columns trimmed.

### Anti-Pattern 4: Mixing Futures P&L into the FIFO Lot System
**What:** Treating futures realized P&L as buy/sell transactions for the margin coin (USDT).
**Why bad:** Futures are a different tax regime (Abgeltungssteuer, no Haltefrist). They should not create FIFO lots or holding-period calculations.
**Instead:** Separate `futures_positions` table. Separate `FuturesPnlEngine`. Separate tax bucket in `tax_summaries`.

### Anti-Pattern 5: Fetching Prices at Query Time
**What:** Calling the Bitget API every time the dashboard loads to get current prices.
**Why bad:** Rate limits, latency, and incorrect tax calculations (need historical price at transaction time, not current price).
**Instead:** Enrich prices once during import (Stage 4 of pipeline). Cache in `price_cache`. Display enrichment progress in UI.

---

## Sources

- Vite `server.proxy` configuration: https://vite.dev/config/server-options.html (verified via WebFetch, HIGH confidence)
- better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3 (verified via WebFetch, HIGH confidence)
- Decimal.js arbitrary precision: https://mikemcl.github.io/decimal.js/ (verified via WebFetch, HIGH confidence)
- fast-check property testing: https://fast-check.dev/ (verified via WebFetch, HIGH confidence)
- Vitest configuration: https://vitest.dev/guide/ (verified via WebFetch, HIGH confidence)
- Multer memory storage: https://github.com/expressjs/multer (verified via WebFetch, HIGH confidence)
- Node.js crypto AES-256-GCM: https://nodejs.org/api/crypto.html (verified via WebFetch, HIGH confidence)
- Bitget API endpoint pattern: `get_eur_prices_bitget.py` in `references/` (reverse-engineered, HIGH confidence)
- CSV format inspection: `raw-bitget-exports/` directory (direct file read, HIGH confidence)
- German tax law (§23 EStG, §20 EStG, Haltefrist, Abgeltungssteuer): training data — MEDIUM confidence. No official BMF source was accessible. Recommend verification with a Steuerberater before relying on tax_summaries output for actual tax filing.
