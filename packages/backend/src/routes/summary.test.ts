import fs from 'node:fs';
import path from 'node:path';
import type { YearSummaryResponse } from '@cryptax/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import {
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// DB mock — same pattern as engine.test.ts
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/client.js', () => ({
  get db() {
    return mockDb;
  },
  get sqlite() {
    return undefined;
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
// Import route registrar (after mocks)
// ---------------------------------------------------------------------------

import { registerSummaryRoutes } from './summary.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTxInsert(
  overrides: Partial<typeof transactions.$inferInsert> = {}
): typeof transactions.$inferInsert {
  return {
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '0.1',
    price: '30000',
    fee: '0',
    totalValue: '3000',
    tradedAt: '2024-06-01T12:00:00.000Z',
    taxYear: 2024,
    checksum: 'abc123',
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSummaryInsert(
  overrides: Partial<typeof taxSummaries.$inferInsert> = {}
): typeof taxSummaries.$inferInsert {
  return {
    taxYear: 2024,
    bucket: 'private_sale',
    totalGainsEur: '1500',
    totalLossesEur: '-200',
    netEur: '1300',
    taxableAmountEur: '300',
    estimatedTaxEur: '0',
    tradeCount: 3,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLotInsert(
  overrides: Partial<typeof fifoLots.$inferInsert> = {}
): typeof fifoLots.$inferInsert {
  return {
    symbol: 'BTC',
    originalAmount: '0.1',
    remainingAmount: '0.1',
    costBasisEur: '3000',
    costPerUnitEur: '30000',
    feeEur: '0',
    acquiredAt: '2024-01-01T00:00:00.000Z',
    taxYear: 2024,
    ...overrides,
  };
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

  app = new Hono();
  registerSummaryRoutes(app);
}

// ---------------------------------------------------------------------------
// GET /api/summary/:year — validation
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — input validation', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns 400 for non-numeric year param', async () => {
    const res = await app.request('/api/summary/notayear');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('notayear');
  });

  it('returns 400 for empty string year', async () => {
    // Route won't match empty string (Hono routing), so test a clearly invalid value
    const res = await app.request('/api/summary/abc');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — engineHasRun=false
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — engine has not run', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns engineHasRun=false when tax_summaries is empty', async () => {
    const res = await app.request('/api/summary/2024');
    expect(res.status).toBe(200);

    const body = (await res.json()) as YearSummaryResponse;
    expect(body.engineHasRun).toBe(false);
    expect(body.taxYear).toBe(2024);
  });

  it('returns zero values for all numeric fields when engine has not run', async () => {
    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.totalNetEur).toBe('0');
    expect(body.totalTradeCount).toBe(0);
    expect(body.totalTaxableEur).toBe('0');
    expect(body.totalEstimatedTaxEur).toBe('0');
    expect(body.spotNetForFreigrenze).toBe('0');
    expect(body.earnTotalForFreigrenze).toBe('0');
  });

  it('returns empty arrays for all chart fields when engine has not run', async () => {
    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.availableYears).toEqual([]);
    expect(body.buckets).toEqual([]);
    expect(body.monthlySpot).toEqual([]);
    expect(body.monthlyFutures).toEqual([]);
    expect(body.perCoinGainLoss).toEqual([]);
    expect(body.portfolioAllocation).toEqual([]);
    expect(body.yearOverYear).toEqual([]);
  });

  it('returns Freigrenze constants even when engine has not run', async () => {
    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.spotFreigrenzeEur).toBe('1000');
    expect(body.earnFreigrenzeEur).toBe('256');
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — buckets and KPIs
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — buckets and KPIs', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns correct buckets for the requested year', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, netEur: '1300', tradeCount: 3 }),
      makeSummaryInsert({ bucket: 'futures_pnl', taxYear: 2024, netEur: '500', tradeCount: 2 }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    expect(res.status).toBe(200);

    const body = (await res.json()) as YearSummaryResponse;
    expect(body.engineHasRun).toBe(true);
    expect(body.buckets).toHaveLength(2);

    const spotBucket = body.buckets.find((b) => b.bucket === 'private_sale');
    expect(spotBucket).toBeDefined();
    expect(spotBucket?.netEur).toBe('1300');
    expect(spotBucket?.tradeCount).toBe(3);

    const futuresBucket = body.buckets.find((b) => b.bucket === 'futures_pnl');
    expect(futuresBucket).toBeDefined();
    expect(futuresBucket?.netEur).toBe('500');
  });

  it('does NOT return buckets for other years', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2023, netEur: '999' }),
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, netEur: '1300' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].netEur).toBe('1300');
  });

  it('aggregates totalNetEur from all buckets', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, netEur: '1300' }),
      makeSummaryInsert({ bucket: 'futures_pnl', taxYear: 2024, netEur: '500' }),
      makeSummaryInsert({ bucket: 'staking_earn', taxYear: 2024, netEur: '200' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    // 1300 + 500 + 200 = 2000
    expect(parseFloat(body.totalNetEur)).toBeCloseTo(2000, 5);
    expect(body.totalTradeCount).toBe(9); // 3 per bucket from makeSummaryInsert default
  });

  it('aggregates totalTaxableEur and totalEstimatedTaxEur correctly', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, taxableAmountEur: '300', estimatedTaxEur: '0' }),
      makeSummaryInsert({ bucket: 'futures_pnl', taxYear: 2024, taxableAmountEur: '500', estimatedTaxEur: '131.875' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(parseFloat(body.totalTaxableEur)).toBeCloseTo(800, 5);
    expect(parseFloat(body.totalEstimatedTaxEur)).toBeCloseTo(131.875, 5);
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — available years
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — available years', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns all years from tax_summaries', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ taxYear: 2022 }),
      makeSummaryInsert({ taxYear: 2023 }),
      makeSummaryInsert({ taxYear: 2024 }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.availableYears).toContain(2022);
    expect(body.availableYears).toContain(2023);
    expect(body.availableYears).toContain(2024);
    expect(body.availableYears).toHaveLength(3);
  });

  it('includes years even if requested year has no data', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ taxYear: 2022 }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    // Engine has run (tax_summaries not empty), but no data for 2024
    expect(body.engineHasRun).toBe(true);
    expect(body.availableYears).toContain(2022);
    expect(body.buckets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — monthly spot chart data
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — monthly spot data', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns monthly spot grouped by YYYY-MM', async () => {
    // Insert engine marker so engineHasRun=true
    mockDb.insert(taxSummaries).values(makeSummaryInsert()).run();

    // Insert two transactions in different months
    const [tx1] = mockDb.insert(transactions).values(
      makeTxInsert({ tradedAt: '2024-01-15T00:00:00.000Z', canonicalType: 'sell', checksum: 'tx1' })
    ).returning().all();

    const [tx2] = mockDb.insert(transactions).values(
      makeTxInsert({ tradedAt: '2024-02-10T00:00:00.000Z', canonicalType: 'sell', checksum: 'tx2' })
    ).returning().all();

    // Insert fifo lots (needed for lot_consumptions FK)
    const [lot1] = mockDb.insert(fifoLots).values(makeLotInsert()).returning().all();

    // Insert lot consumptions
    mockDb.insert(lotConsumptions).values([
      {
        lotId: lot1.id,
        sellTransactionId: tx1.id,
        amountConsumed: '0.05',
        costBasisEur: '1500',
        proceedsEur: '2000',
        gainLossEur: '500',
        feeEur: '0',
        heldDays: 100,
        haltefristMet: false,
        taxYear: 2024,
      },
      {
        lotId: lot1.id,
        sellTransactionId: tx2.id,
        amountConsumed: '0.02',
        costBasisEur: '600',
        proceedsEur: '400',
        gainLossEur: '-200',
        feeEur: '0',
        heldDays: 50,
        haltefristMet: false,
        taxYear: 2024,
      },
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.monthlySpot).toHaveLength(2);

    const jan = body.monthlySpot.find((m) => m.month === '2024-01');
    const feb = body.monthlySpot.find((m) => m.month === '2024-02');

    expect(jan).toBeDefined();
    expect(parseFloat(jan!.gains)).toBeCloseTo(500, 5);
    expect(parseFloat(jan!.losses)).toBeCloseTo(0, 5);

    expect(feb).toBeDefined();
    expect(parseFloat(feb!.gains)).toBeCloseTo(0, 5);
    expect(parseFloat(feb!.losses)).toBeCloseTo(-200, 5);
  });

  it('returns empty monthlySpot when no lot consumptions exist for year', async () => {
    mockDb.insert(taxSummaries).values(makeSummaryInsert()).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.monthlySpot).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — portfolio allocation
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — portfolio allocation', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('only includes lots with remaining_amount > 0', async () => {
    mockDb.insert(taxSummaries).values(makeSummaryInsert()).run();

    mockDb.insert(fifoLots).values([
      makeLotInsert({ symbol: 'BTC', remainingAmount: '0.5', costPerUnitEur: '30000' }),
      makeLotInsert({ symbol: 'ETH', remainingAmount: '0', costPerUnitEur: '2000' }),
      makeLotInsert({ symbol: 'SOL', remainingAmount: '10', costPerUnitEur: '150' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    const symbols = body.portfolioAllocation.map((p) => p.symbol);
    expect(symbols).toContain('BTC');
    expect(symbols).toContain('SOL');
    expect(symbols).not.toContain('ETH'); // zero remaining should be excluded
  });

  it('calculates portfolio value as remainingAmount * costPerUnitEur', async () => {
    mockDb.insert(taxSummaries).values(makeSummaryInsert()).run();

    mockDb.insert(fifoLots).values([
      makeLotInsert({ symbol: 'BTC', remainingAmount: '0.5', costPerUnitEur: '30000' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    const btc = body.portfolioAllocation.find((p) => p.symbol === 'BTC');
    expect(btc).toBeDefined();
    // 0.5 * 30000 = 15000
    expect(parseFloat(btc!.valueEur)).toBeCloseTo(15000, 5);
  });

  it('portfolio allocation is not filtered by year', async () => {
    // Insert summaries for 2023 (so engineHasRun=true)
    mockDb.insert(taxSummaries).values(makeSummaryInsert({ taxYear: 2023 })).run();

    // Insert lots from 2023 with remaining amount
    mockDb.insert(fifoLots).values([
      makeLotInsert({ symbol: 'BTC', remainingAmount: '1', costPerUnitEur: '20000', taxYear: 2023 }),
    ]).run();

    // Request for 2024 (different year)
    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    // Should still show BTC from 2023 lots
    const btc = body.portfolioAllocation.find((p) => p.symbol === 'BTC');
    expect(btc).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — Freigrenze fields
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — Freigrenze', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns spotNetForFreigrenze from private_sale bucket netEur', async () => {
    mockDb.insert(taxSummaries).values(
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, netEur: '850' })
    ).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.spotNetForFreigrenze).toBe('850');
  });

  it('returns earnTotalForFreigrenze from staking_earn bucket netEur', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ bucket: 'private_sale', taxYear: 2024, netEur: '100' }),
      makeSummaryInsert({ bucket: 'staking_earn', taxYear: 2024, netEur: '180' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.earnTotalForFreigrenze).toBe('180');
  });

  it('returns 0 for spotNetForFreigrenze when no private_sale bucket exists', async () => {
    mockDb.insert(taxSummaries).values(
      makeSummaryInsert({ bucket: 'futures_pnl', taxYear: 2024, netEur: '500' })
    ).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.spotNetForFreigrenze).toBe('0');
    expect(body.earnTotalForFreigrenze).toBe('0');
  });

  it('returns Freigrenze limits as constants', async () => {
    mockDb.insert(taxSummaries).values(makeSummaryInsert()).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.spotFreigrenzeEur).toBe('1000');
    expect(body.earnFreigrenzeEur).toBe('256');
  });
});

// ---------------------------------------------------------------------------
// GET /api/summary/:year — year-over-year
// ---------------------------------------------------------------------------

describe('GET /api/summary/:year — year-over-year', () => {
  beforeEach(setupApp);
  afterEach(() => sqlite.close());

  it('returns year-over-year data for all years in tax_summaries', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ taxYear: 2022, bucket: 'private_sale', netEur: '400' }),
      makeSummaryInsert({ taxYear: 2023, bucket: 'private_sale', netEur: '600' }),
      makeSummaryInsert({ taxYear: 2023, bucket: 'futures_pnl', netEur: '200' }),
      makeSummaryInsert({ taxYear: 2024, bucket: 'private_sale', netEur: '1300' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    expect(body.yearOverYear).toHaveLength(3);

    const yoy2022 = body.yearOverYear.find((y) => y.taxYear === 2022);
    expect(yoy2022?.spotNet).toBe('400');
    expect(yoy2022?.futuresNet).toBe('0');
    expect(yoy2022?.earnNet).toBe('0');

    const yoy2023 = body.yearOverYear.find((y) => y.taxYear === 2023);
    expect(yoy2023?.spotNet).toBe('600');
    expect(yoy2023?.futuresNet).toBe('200');
    expect(yoy2023?.earnNet).toBe('0');
  });

  it('year-over-year is sorted ascending by year', async () => {
    mockDb.insert(taxSummaries).values([
      makeSummaryInsert({ taxYear: 2024, bucket: 'private_sale' }),
      makeSummaryInsert({ taxYear: 2022, bucket: 'private_sale' }),
      makeSummaryInsert({ taxYear: 2023, bucket: 'private_sale' }),
    ]).run();

    const res = await app.request('/api/summary/2024');
    const body = (await res.json()) as YearSummaryResponse;

    const years = body.yearOverYear.map((y) => y.taxYear);
    expect(years).toEqual([2022, 2023, 2024]);
  });
});
