import fs from 'node:fs';
import path from 'node:path';
import type { TransactionDetailResponse, TransactionPageResponse } from '@cryptax/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — same pattern as engine.test.ts
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;
let mockSqlite: ReturnType<typeof Database>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return mockSqlite;
  },
}));

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>) {
  const migrationsDir = path.resolve(process.cwd(), 'packages/backend/drizzle');
  for (const file of [
    '0000_initial.sql',
    '0001_import_batches.sql',
    '0002_eur_price_columns.sql',
  ]) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }
}

// ---------------------------------------------------------------------------
// Route registrar (after mocks)
// ---------------------------------------------------------------------------

import { registerTransactionRoutes } from './transactions.js';

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

function makeTransaction(
  sqlite: ReturnType<typeof Database>,
  overrides: Partial<{
    orderId: string;
    exchange: string;
    sourceType: string;
    canonicalType: string;
    symbol: string;
    side: string;
    amount: string;
    price: string;
    fee: string;
    totalValue: string;
    tradedAt: string;
    taxYear: number;
    checksum: string;
    eurPrice: string;
  }> = {}
): number {
  const defaults = {
    orderId: 'ORD-001',
    exchange: 'Bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '0.5',
    price: '50000',
    fee: '10',
    totalValue: '25000',
    tradedAt: '2024-06-01T12:00:00.000Z',
    taxYear: 2024,
    checksum: `chk-${Math.random()}`,
    eurPrice: '46000',
    sourceFile: null,
    rawRow: null,
    importedAt: new Date().toISOString(),
    batchId: null,
    priceSource: 'coingecko',
    priceResolvedAt: null,
    priceFailureReason: null,
    ...overrides,
  };

  const result = sqlite
    .prepare(
      `INSERT INTO transactions
        (order_id, exchange, source_type, canonical_type, symbol, side, amount,
         price, fee, total_value, traded_at, tax_year, source_file, raw_row,
         checksum, imported_at, batch_id, eur_price, price_source,
         price_resolved_at, price_failure_reason)
       VALUES
        (@orderId, @exchange, @sourceType, @canonicalType, @symbol, @side, @amount,
         @price, @fee, @totalValue, @tradedAt, @taxYear, @sourceFile, @rawRow,
         @checksum, @importedAt, @batchId, @eurPrice, @priceSource,
         @priceResolvedAt, @priceFailureReason)`
    )
    .run(defaults);

  return Number(result.lastInsertRowid);
}

function makeFifoLot(
  sqlite: ReturnType<typeof Database>,
  opts: {
    symbol: string;
    acquiredAt: string;
    taxYear: number;
    transactionId?: number;
    originalAmount?: string;
    remainingAmount?: string;
    costBasisEur?: string;
    costPerUnitEur?: string;
  }
): number {
  const result = sqlite
    .prepare(
      `INSERT INTO fifo_lots
        (symbol, original_amount, remaining_amount, cost_basis_eur,
         cost_per_unit_eur, fee_eur, acquired_at, transaction_id, tax_year)
       VALUES
        (@symbol, @originalAmount, @remainingAmount, @costBasisEur,
         @costPerUnitEur, @feeEur, @acquiredAt, @transactionId, @taxYear)`
    )
    .run({
      symbol: opts.symbol,
      originalAmount: opts.originalAmount ?? '0.5',
      remainingAmount: opts.remainingAmount ?? '0',
      costBasisEur: opts.costBasisEur ?? '23000',
      costPerUnitEur: opts.costPerUnitEur ?? '46000',
      feeEur: '5',
      acquiredAt: opts.acquiredAt,
      transactionId: opts.transactionId ?? null,
      taxYear: opts.taxYear,
    });

  return Number(result.lastInsertRowid);
}

function makeLotConsumption(
  sqlite: ReturnType<typeof Database>,
  opts: {
    lotId: number;
    sellTransactionId: number;
    taxYear: number;
    heldDays?: number;
    haltefristMet?: number;
    gainLossEur?: string;
  }
): number {
  const result = sqlite
    .prepare(
      `INSERT INTO lot_consumptions
        (lot_id, sell_transaction_id, amount_consumed, cost_basis_eur,
         proceeds_eur, gain_loss_eur, fee_eur, held_days, haltefrist_met, tax_year)
       VALUES
        (@lotId, @sellTransactionId, @amountConsumed, @costBasisEur,
         @proceedsEur, @gainLossEur, @feeEur, @heldDays, @haltefristMet, @taxYear)`
    )
    .run({
      lotId: opts.lotId,
      sellTransactionId: opts.sellTransactionId,
      amountConsumed: '0.5',
      costBasisEur: '23000',
      proceedsEur: '25000',
      gainLossEur: opts.gainLossEur ?? '2000',
      feeEur: '5',
      heldDays: opts.heldDays ?? 200,
      haltefristMet: opts.haltefristMet ?? 0,
      taxYear: opts.taxYear,
    });

  return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let app: Hono;
let sqlite: ReturnType<typeof Database>;

function setupApp() {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  mockDb = drizzle(sqlite, { schema });
  mockSqlite = sqlite;

  app = new Hono();
  registerTransactionRoutes(app);
}

// ---------------------------------------------------------------------------
// GET /api/transactions — list endpoint
// ---------------------------------------------------------------------------

describe('GET /api/transactions', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns empty list when no transactions exist', async () => {
    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(50);
  });

  it('returns paginated results with correct total and hasMore', async () => {
    // Insert 3 transactions
    makeTransaction(sqlite, { checksum: 'c1', tradedAt: '2024-01-01T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c2', tradedAt: '2024-02-01T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c3', tradedAt: '2024-03-01T00:00:00.000Z' });

    // Get first page of 2
    const res = await app.request('/api/transactions?limit=2&offset=0');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it('returns hasMore=false on the last page', async () => {
    makeTransaction(sqlite, { checksum: 'c1' });
    makeTransaction(sqlite, { checksum: 'c2' });
    makeTransaction(sqlite, { checksum: 'c3' });

    const res = await app.request('/api/transactions?limit=2&offset=2');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it('filters by year', async () => {
    makeTransaction(sqlite, {
      checksum: 'c1',
      taxYear: 2023,
      tradedAt: '2023-06-01T00:00:00.000Z',
    });
    makeTransaction(sqlite, {
      checksum: 'c2',
      taxYear: 2024,
      tradedAt: '2024-06-01T00:00:00.000Z',
    });
    makeTransaction(sqlite, {
      checksum: 'c3',
      taxYear: 2024,
      tradedAt: '2024-07-01T00:00:00.000Z',
    });

    const res = await app.request('/api/transactions?year=2024');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(2);
    expect(body.items.every((i) => i.taxYear === 2024)).toBe(true);
  });

  it('filters by type', async () => {
    makeTransaction(sqlite, { checksum: 'c1', canonicalType: 'buy' });
    makeTransaction(sqlite, { checksum: 'c2', canonicalType: 'sell' });
    makeTransaction(sqlite, { checksum: 'c3', canonicalType: 'sell' });

    const res = await app.request('/api/transactions?type=sell');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(2);
    expect(body.items.every((i) => i.canonicalType === 'sell')).toBe(true);
  });

  it('filters by coin (exact match)', async () => {
    makeTransaction(sqlite, { checksum: 'c1', symbol: 'BTC' });
    makeTransaction(sqlite, { checksum: 'c2', symbol: 'ETH' });
    makeTransaction(sqlite, { checksum: 'c3', symbol: 'BTC' });

    const res = await app.request('/api/transactions?coin=BTC');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(2);
    expect(body.items.every((i) => i.baseCoin === 'BTC')).toBe(true);
  });

  it('coin filter matches spot_order pair symbols (e.g. BTC/EUR)', async () => {
    makeTransaction(sqlite, {
      checksum: 'c-order',
      symbol: 'BTC/EUR',
      sourceType: 'spot_order',
      orderId: 'ORD-COIN-001',
    });
    makeTransaction(sqlite, {
      checksum: 'c-tx',
      symbol: 'ETH',
      sourceType: 'spot_tx',
      orderId: 'ORD-COIN-002',
    });

    const res = await app.request('/api/transactions?coin=BTC');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(1);
    expect(body.items[0].baseCoin).toBe('BTC');
    expect(body.items[0].tradingPair).toBe('BTC/EUR');
  });

  it('filters by date range', async () => {
    makeTransaction(sqlite, { checksum: 'c1', tradedAt: '2024-01-01T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c2', tradedAt: '2024-06-15T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c3', tradedAt: '2024-12-31T00:00:00.000Z' });

    const res = await app.request(
      '/api/transactions?from=2024-01-01T00:00:00.000Z&to=2024-07-01T00:00:00.000Z'
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(2);
  });

  it('searches by symbol (case-insensitive LIKE)', async () => {
    makeTransaction(sqlite, { checksum: 'c1', symbol: 'BTC' });
    makeTransaction(sqlite, { checksum: 'c2', symbol: 'ETH' });
    makeTransaction(sqlite, { checksum: 'c3', symbol: 'btc' });

    const res = await app.request('/api/transactions?search=btc');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    // LIKE in SQLite is case-insensitive for ASCII by default
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.some((i) => i.symbol.toLowerCase() === 'btc')).toBe(true);
  });

  it('searches by orderId', async () => {
    makeTransaction(sqlite, { checksum: 'c1', orderId: 'ORD-SEARCH-001', symbol: 'BTC' });
    makeTransaction(sqlite, { checksum: 'c2', orderId: 'ORD-OTHER-002', symbol: 'ETH' });

    const res = await app.request('/api/transactions?search=SEARCH');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(1);
    expect(body.items[0].orderId).toBe('ORD-SEARCH-001');
  });

  it('sorts by amount numerically (not lexicographic)', async () => {
    // Lexicographic: "9" > "10" > "2". Numeric: 9 < 10, 2 < 9
    makeTransaction(sqlite, { checksum: 'c1', amount: '2' });
    makeTransaction(sqlite, { checksum: 'c2', amount: '9' });
    makeTransaction(sqlite, { checksum: 'c3', amount: '10' });

    const res = await app.request('/api/transactions?sortBy=amount&sortDir=asc');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.items).toHaveLength(3);
    // Numeric ascending: 2, 9, 10
    expect(parseFloat(body.items[0].amount)).toBeLessThan(parseFloat(body.items[1].amount));
    expect(parseFloat(body.items[1].amount)).toBeLessThan(parseFloat(body.items[2].amount));
    expect(body.items[0].amount).toBe('2');
    expect(body.items[1].amount).toBe('9');
    expect(body.items[2].amount).toBe('10');
  });

  it('sorts by amount descending numerically', async () => {
    makeTransaction(sqlite, { checksum: 'c1', amount: '2' });
    makeTransaction(sqlite, { checksum: 'c2', amount: '9' });
    makeTransaction(sqlite, { checksum: 'c3', amount: '10' });

    const res = await app.request('/api/transactions?sortBy=amount&sortDir=desc');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.items[0].amount).toBe('10');
    expect(body.items[1].amount).toBe('9');
    expect(body.items[2].amount).toBe('2');
  });

  it('sorts by tradedAt descending by default', async () => {
    makeTransaction(sqlite, { checksum: 'c1', tradedAt: '2024-01-01T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c2', tradedAt: '2024-03-01T00:00:00.000Z' });
    makeTransaction(sqlite, { checksum: 'c3', tradedAt: '2024-02-01T00:00:00.000Z' });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.items[0].tradedAt).toBe('2024-03-01T00:00:00.000Z');
    expect(body.items[2].tradedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('caps limit at 200', async () => {
    const res = await app.request('/api/transactions?limit=999');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.limit).toBe(200);
  });

  it('returns TransactionListItem with expected fields', async () => {
    makeTransaction(sqlite, {
      checksum: 'c1',
      orderId: 'ORD-FIELD-TEST',
      symbol: 'ETH',
      canonicalType: 'sell',
      sourceType: 'spot_order',
      eurPrice: '3200',
      exchange: 'Bitget',
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    const item = body.items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('orderId', 'ORD-FIELD-TEST');
    expect(item).toHaveProperty('symbol', 'ETH');
    expect(item).toHaveProperty('baseCoin');
    expect(item).toHaveProperty('tradingPair');
    expect(item).toHaveProperty('canonicalType', 'sell');
    expect(item).toHaveProperty('sourceType', 'spot_order');
    expect(item).toHaveProperty('eurPrice', '3200');
    expect(item).toHaveProperty('exchange', 'Bitget');
    expect(item).toHaveProperty('tradedAt');
    expect(item).toHaveProperty('taxYear');
    expect(item).toHaveProperty('amount');
    expect(item).toHaveProperty('fee');
    expect(item).toHaveProperty('totalValue');
    expect(item).toHaveProperty('gainLossEur');
  });

  it('returns gainLossEur from FIFO lot consumptions for sell transactions', async () => {
    const buyId = makeTransaction(sqlite, {
      checksum: 'c-buy-pnl',
      symbol: 'ETH',
      canonicalType: 'buy',
      tradedAt: '2024-01-01T00:00:00.000Z',
      taxYear: 2024,
    });
    const lotId = makeFifoLot(sqlite, {
      symbol: 'ETH',
      acquiredAt: '2024-01-01T00:00:00.000Z',
      taxYear: 2024,
      transactionId: buyId,
    });
    const sellId = makeTransaction(sqlite, {
      checksum: 'c-sell-pnl',
      symbol: 'ETH',
      canonicalType: 'sell',
      side: 'sell',
      tradedAt: '2024-06-15T00:00:00.000Z',
      taxYear: 2024,
    });
    makeLotConsumption(sqlite, {
      lotId,
      sellTransactionId: sellId,
      taxYear: 2024,
      gainLossEur: '1500.50',
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    const sellItem = body.items.find((i) => i.id === sellId);
    expect(sellItem).toBeDefined();
    expect(parseFloat(sellItem?.gainLossEur!)).toBeCloseTo(1500.5, 1);

    // Buy should have no P&L
    const buyItem = body.items.find((i) => i.id === buyId);
    expect(buyItem?.gainLossEur).toBeNull();
  });

  it('returns gainLossEur from futures positions', async () => {
    const txId = makeTransaction(sqlite, {
      checksum: 'c-futures-pnl-list',
      symbol: 'BTC',
      canonicalType: 'futures_close_long',
      taxYear: 2024,
    });
    sqlite
      .prepare(
        `INSERT INTO futures_positions (symbol, realized_pnl_eur, fee_eur, transaction_id, tax_year)
         VALUES ('BTC', '800', '20', @transactionId, 2024)`
      )
      .run({ transactionId: txId });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    const item = body.items.find((i) => i.id === txId);
    expect(item).toBeDefined();
    expect(parseFloat(item?.gainLossEur!)).toBeCloseTo(780, 1); // 800 - 20
  });

  it('collapses spot_tx rows when a matching spot_order exists (same timestamp)', async () => {
    const tradedAt = '2024-12-10T11:15:01.000Z';
    makeTransaction(sqlite, {
      checksum: 'c-order',
      orderId: 'ORD-ORDER-001',
      symbol: 'MOZ/USDT',
      sourceType: 'spot_order',
      canonicalType: 'buy',
      amount: '1234.56',
      price: '0.04',
      fee: '0',
      tradedAt,
    });
    // spot_tx for the base coin (MOZ) — different orderId from Bitget
    makeTransaction(sqlite, {
      checksum: 'c-tx-base',
      orderId: 'ORD-TX-001',
      symbol: 'MOZ',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      amount: '1234.56',
      fee: '-1.234',
      tradedAt,
    });
    // spot_tx for the quote coin (USDT) — different orderId from Bitget
    makeTransaction(sqlite, {
      checksum: 'c-tx-quote',
      orderId: 'ORD-TX-002',
      symbol: 'USDT',
      sourceType: 'spot_tx',
      canonicalType: 'sell',
      amount: '-49.38',
      fee: '0',
      tradedAt,
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    // Should only have 1 row (the spot_order), not 3
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sourceType).toBe('spot_order');
    expect(body.items[0].baseCoin).toBe('MOZ');
    expect(body.items[0].tradingPair).toBe('MOZ/USDT');
  });

  it('keeps spot_tx rows that have no matching spot_order', async () => {
    makeTransaction(sqlite, {
      checksum: 'c-standalone',
      orderId: 'ORD-STANDALONE',
      symbol: 'BTC',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      tradedAt: '2024-12-10T11:00:00.000Z',
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.total).toBe(1);
    expect(body.items[0].sourceType).toBe('spot_tx');
    expect(body.items[0].baseCoin).toBe('BTC');
    expect(body.items[0].tradingPair).toBeNull();
  });

  it('merges fee from spot_tx into the collapsed spot_order row', async () => {
    const tradedAt = '2024-12-10T11:14:38.000Z';
    makeTransaction(sqlite, {
      checksum: 'c-order-fee',
      orderId: 'ORD-ORDER-FEE',
      symbol: 'ETH/EUR',
      sourceType: 'spot_order',
      canonicalType: 'sell',
      fee: '0',
      tradedAt,
    });
    makeTransaction(sqlite, {
      checksum: 'c-tx-fee',
      orderId: 'ORD-TX-FEE-1',
      symbol: 'EUR',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      fee: '-3.25',
      tradedAt,
    });
    makeTransaction(sqlite, {
      checksum: 'c-tx-fee2',
      orderId: 'ORD-TX-FEE-2',
      symbol: 'ETH',
      sourceType: 'spot_tx',
      canonicalType: 'sell',
      fee: '0',
      tradedAt,
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionPageResponse;
    expect(body.items).toHaveLength(1);
    // Fee from spot_tx should be merged (abs of -3.25 = 3.25)
    expect(parseFloat(body.items[0].fee)).toBeCloseTo(3.25, 2);
  });
});

// ---------------------------------------------------------------------------
// GET /api/transactions/:id — detail endpoint
// ---------------------------------------------------------------------------

describe('GET /api/transactions/:id', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 404 for non-existent id', async () => {
    const res = await app.request('/api/transactions/999999');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('999999');
  });

  it('returns 400 for invalid (non-numeric) id', async () => {
    const res = await app.request('/api/transactions/not-a-number');
    expect(res.status).toBe(400);
  });

  it('returns full transaction detail for a buy transaction', async () => {
    const txId = makeTransaction(sqlite, {
      checksum: 'c-detail-buy',
      symbol: 'BTC',
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '46000',
    });

    const res = await app.request(`/api/transactions/${txId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.transaction.id).toBe(txId);
    expect(body.transaction.symbol).toBe('BTC');
    expect(body.transaction.canonicalType).toBe('buy');

    // Buy has no lot consumptions
    expect(body.lotConsumptions).toHaveLength(0);

    // No futures or earn data
    expect(body.futuresPosition).toBeNull();
    expect(body.earnIncome).toBeNull();

    // taxImpact: no event
    expect(body.taxImpact.bucket).toBeNull();
    expect(body.taxImpact.isTaxFree).toBe(true);
    expect(body.taxImpact.reason).toBe('No tax event');
  });

  it('returns FIFO lot consumptions for a sell transaction', async () => {
    // Create a buy transaction (source lot)
    const buyId = makeTransaction(sqlite, {
      checksum: 'c-buy-for-lot',
      symbol: 'ETH',
      canonicalType: 'buy',
      tradedAt: '2024-01-01T00:00:00.000Z',
      taxYear: 2024,
    });

    // Create a FIFO lot from the buy
    const lotId = makeFifoLot(sqlite, {
      symbol: 'ETH',
      acquiredAt: '2024-01-01T00:00:00.000Z',
      taxYear: 2024,
      transactionId: buyId,
      costPerUnitEur: '2000',
    });

    // Create a sell transaction
    const sellId = makeTransaction(sqlite, {
      checksum: 'c-sell-detail',
      symbol: 'ETH',
      canonicalType: 'sell',
      tradedAt: '2024-06-15T00:00:00.000Z',
      taxYear: 2024,
      side: 'sell',
    });

    // Create lot consumption linking sell to buy lot
    makeLotConsumption(sqlite, {
      lotId,
      sellTransactionId: sellId,
      taxYear: 2024,
      heldDays: 165,
      haltefristMet: 0,
      gainLossEur: '2000',
    });

    const res = await app.request(`/api/transactions/${sellId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.transaction.id).toBe(sellId);
    expect(body.lotConsumptions).toHaveLength(1);

    const lc = body.lotConsumptions[0];
    expect(lc.lotId).toBe(lotId);
    expect(lc.heldDays).toBe(165);
    expect(lc.haltefristMet).toBe(false);
    expect(lc.gainLossEur).toBe('2000');
    expect(lc.symbol).toBe('ETH');
    expect(lc.acquiredAt).toBe('2024-01-01T00:00:00.000Z');
    expect(lc.costPerUnitEur).toBe('2000');

    // taxImpact: private_sale, not tax-free (haltefristMet=false)
    expect(body.taxImpact.bucket).toBe('private_sale');
    expect(body.taxImpact.totalGainLossEur).toBe('2000');
    expect(body.taxImpact.isTaxFree).toBe(false);
    expect(body.taxImpact.reason).toBe('Taxable');
  });

  it('returns taxImpact.isTaxFree=true when all lots have haltefristMet', async () => {
    const buyId = makeTransaction(sqlite, {
      checksum: 'c-buy-haltefrist',
      symbol: 'BTC',
      canonicalType: 'buy',
      taxYear: 2023,
      tradedAt: '2023-01-01T00:00:00.000Z',
    });

    const lotId = makeFifoLot(sqlite, {
      symbol: 'BTC',
      acquiredAt: '2023-01-01T00:00:00.000Z',
      taxYear: 2023,
      transactionId: buyId,
    });

    const sellId = makeTransaction(sqlite, {
      checksum: 'c-sell-haltefrist',
      symbol: 'BTC',
      canonicalType: 'sell',
      taxYear: 2024,
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    makeLotConsumption(sqlite, {
      lotId,
      sellTransactionId: sellId,
      taxYear: 2024,
      heldDays: 517,
      haltefristMet: 1, // tax-free
      gainLossEur: '5000',
    });

    const res = await app.request(`/api/transactions/${sellId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.taxImpact.bucket).toBe('private_sale');
    expect(body.taxImpact.isTaxFree).toBe(true);
    expect(body.taxImpact.reason).toBe('Haltefrist met');
  });

  it('returns futures position data for futures close transactions', async () => {
    const txId = makeTransaction(sqlite, {
      checksum: 'c-futures-close',
      symbol: 'BTC',
      canonicalType: 'futures_close_long',
      taxYear: 2024,
    });

    sqlite
      .prepare(
        `INSERT INTO futures_positions (symbol, realized_pnl_eur, fee_eur, transaction_id, tax_year)
         VALUES ('BTC', '500', '10', @transactionId, 2024)`
      )
      .run({ transactionId: txId });

    const res = await app.request(`/api/transactions/${txId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.futuresPosition).not.toBeNull();
    expect(body.futuresPosition?.realizedPnlEur).toBe('500');
    expect(body.futuresPosition?.feeEur).toBe('10');

    // taxImpact: futures_pnl
    expect(body.taxImpact.bucket).toBe('futures_pnl');
    expect(body.taxImpact.totalGainLossEur).toBe('490');
    expect(body.taxImpact.isTaxFree).toBe(false);
  });

  it('returns earn income data for earn transactions', async () => {
    const txId = makeTransaction(sqlite, {
      checksum: 'c-earn',
      symbol: 'USDT',
      canonicalType: 'earn_interest',
      taxYear: 2024,
    });

    sqlite
      .prepare(
        `INSERT INTO earn_income (symbol, amount, eur_value_at_receipt, received_at, transaction_id, tax_year)
         VALUES ('USDT', '100', '92', '2024-03-01T00:00:00.000Z', @transactionId, 2024)`
      )
      .run({ transactionId: txId });

    const res = await app.request(`/api/transactions/${txId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.earnIncome).not.toBeNull();
    expect(body.earnIncome?.amount).toBe('100');
    expect(body.earnIncome?.eurValueAtReceipt).toBe('92');

    // taxImpact: staking_earn
    expect(body.taxImpact.bucket).toBe('staking_earn');
    expect(body.taxImpact.totalGainLossEur).toBe('92');
    expect(body.taxImpact.isTaxFree).toBe(false);
    expect(body.taxImpact.reason).toBe('Taxable');
  });

  it('returns empty lotConsumptions and null data for buy transaction', async () => {
    const txId = makeTransaction(sqlite, {
      checksum: 'c-buy-no-lots',
      canonicalType: 'buy',
    });

    const res = await app.request(`/api/transactions/${txId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as TransactionDetailResponse;
    expect(body.lotConsumptions).toHaveLength(0);
    expect(body.futuresPosition).toBeNull();
    expect(body.earnIncome).toBeNull();
    expect(body.taxImpact.bucket).toBeNull();
    expect(body.taxImpact.totalGainLossEur).toBe('0');
    expect(body.taxImpact.isTaxFree).toBe(true);
    expect(body.taxImpact.reason).toBe('No tax event');
  });
});
