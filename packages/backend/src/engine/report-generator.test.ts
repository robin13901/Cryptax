/**
 * ReportGenerator Unit Tests
 *
 * Uses in-memory SQLite + full migrations pattern (same as golden-master.test.ts).
 * Seeds data directly into DB tables; runs ReportGenerator.generate(year) and
 * verifies the returned ReportData structure.
 *
 * Scenarios:
 *   1. Returns null for a year with no tax_summaries data
 *   2. SpotSummary — correct aggregation for a year with spot trades only
 *   3. FuturesSummary — correct Abgeltungssteuer calculation
 *   4. EarnSummary — correct per-coin breakdown and Freigrenze status
 *   5. TradeAppendix — includes both haltefrist-met and non-met rows
 *   6. TradeAppendix sorting — sorted by sell date ASC, then symbol ASC
 *   7. Missing bucket returns zero-valued summary (not null/undefined)
 *   8. Mixed year — all three buckets populated simultaneously
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import {
  earnIncome,
  fifoLots,
  futuresPositions,
  lotConsumptions,
  taxSummaries,
  transactions,
} from '../db/schema.js';
import { ReportGenerator } from './report-generator.js';

// ---------------------------------------------------------------------------
// Migration helper (identical to golden-master pattern)
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: ReturnType<typeof Database>): void {
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
// Test setup
// ---------------------------------------------------------------------------

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let sqlite: ReturnType<typeof Database>;
let db: TestDb;
let generator: ReportGenerator;
let checksumCounter = 0;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generator = new ReportGenerator(db as any);
  checksumCounter = 0;
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeTransaction(overrides: Partial<typeof transactions.$inferInsert> = {}) {
  checksumCounter += 1;
  return {
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '1',
    price: '40000',
    fee: '0',
    totalValue: '40000',
    tradedAt: '2024-01-01T00:00:00.000Z',
    taxYear: 2024,
    checksum: `rg-test-${checksumCounter}`,
    importedAt: new Date().toISOString(),
    eurPrice: '40000',
    ...overrides,
  } as typeof transactions.$inferInsert;
}

function makeLot(
  txId: number,
  overrides: Partial<typeof fifoLots.$inferInsert> = {}
): typeof fifoLots.$inferInsert {
  return {
    symbol: 'BTC',
    originalAmount: '1',
    remainingAmount: '0',
    costBasisEur: '40000',
    costPerUnitEur: '40000',
    feeEur: '0',
    acquiredAt: '2024-01-01T00:00:00.000Z',
    transactionId: txId,
    taxYear: 2024,
    ...overrides,
  };
}

function makeTaxSummary(
  overrides: Partial<typeof taxSummaries.$inferInsert> = {}
): typeof taxSummaries.$inferInsert {
  return {
    taxYear: 2024,
    bucket: 'private_sale',
    totalGainsEur: '5000',
    totalLossesEur: '0',
    netEur: '5000',
    taxableAmountEur: '5000',
    estimatedTaxEur: '0',
    tradeCount: 1,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Returns null for a year with no data
// ---------------------------------------------------------------------------

describe('Scenario 1: No data for year', () => {
  it('returns null when tax_summaries has no rows for the requested year', () => {
    const result = generator.generate(2024);
    expect(result).toBeNull();
  });

  it('returns null when data exists for a different year', () => {
    // Insert summary for 2023 only
    db.insert(taxSummaries)
      .values(makeTaxSummary({ taxYear: 2023 }))
      .run();
    const result = generator.generate(2024);
    expect(result).toBeNull();
  });

  it('returns non-null when summary exists for the requested year', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ taxYear: 2024 }))
      .run();
    const result = generator.generate(2024);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: SpotSummary — correct aggregation for spot-only year
// ---------------------------------------------------------------------------

describe('Scenario 2: SpotSummary correct aggregation', () => {
  it('maps all fields from tax_summaries private_sale row', () => {
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({
          bucket: 'private_sale',
          totalGainsEur: '5000',
          totalLossesEur: '-1000',
          netEur: '4000',
          taxableAmountEur: '4000',
          tradeCount: 3,
        })
      )
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const spot = result?.spotSummary;
    expect(spot.totalGainsEur).toBe('5000');
    expect(spot.totalLossesEur).toBe('-1000');
    expect(spot.netEur).toBe('4000');
    expect(spot.taxableAmountEur).toBe('4000');
    expect(spot.tradeCount).toBe(3);
    expect(spot.freigrenzeLimitEur).toBe('1000');
  });

  it('sets freigrenzeStatus = "over" when net > 1000', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ netEur: '1000.01', taxableAmountEur: '1000.01' }))
      .run();

    const result = generator.generate(2024);
    expect(result?.spotSummary.freigrenzeStatus).toBe('over');
  });

  it('sets freigrenzeStatus = "under" when net = 1000 (at cliff, not exceeded)', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ netEur: '1000', taxableAmountEur: '0' }))
      .run();

    const result = generator.generate(2024);
    expect(result?.spotSummary.freigrenzeStatus).toBe('under');
  });

  it('sets freigrenzeStatus = "under" when net < 1000', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ netEur: '500', taxableAmountEur: '0' }))
      .run();

    const result = generator.generate(2024);
    expect(result?.spotSummary.freigrenzeStatus).toBe('under');
  });

  it('counts taxFreeTradeCount from all lot consumptions with haltefristMet=true', () => {
    // Insert two transactions (buy + sell)
    const buyTx = db
      .insert(transactions)
      .values(
        makeTransaction({ canonicalType: 'buy', amount: '2', tradedAt: '2022-01-01T00:00:00.000Z' })
      )
      .returning({ id: transactions.id })
      .get();
    const sellTx = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          amount: '2',
          tradedAt: '2024-06-01T00:00:00.000Z',
        })
      )
      .returning({ id: transactions.id })
      .get();

    // Insert a lot for the buy
    const lot = db
      .insert(fifoLots)
      .values(makeLot(buyTx.id, { symbol: 'BTC', acquiredAt: '2022-01-01T00:00:00.000Z' }))
      .returning({ id: fifoLots.id })
      .get();

    // Insert lot consumptions — two consumptions for the same sell (haltefrist met)
    db.insert(lotConsumptions)
      .values([
        {
          lotId: lot.id,
          sellTransactionId: sellTx.id,
          amountConsumed: '1',
          costBasisEur: '40000',
          proceedsEur: '50000',
          gainLossEur: '10000',
          feeEur: '0',
          heldDays: 880,
          haltefristMet: true,
          taxYear: 2024,
        },
        {
          lotId: lot.id,
          sellTransactionId: sellTx.id,
          amountConsumed: '1',
          costBasisEur: '40000',
          proceedsEur: '50000',
          gainLossEur: '10000',
          feeEur: '0',
          heldDays: 880,
          haltefristMet: true,
          taxYear: 2024,
        },
      ])
      .run();

    db.insert(taxSummaries).values(makeTaxSummary()).run();

    const result = generator.generate(2024);
    // Two lot consumptions, same sell transaction — each counts as one disposal
    expect(result?.spotSummary.taxFreeTradeCount).toBe(2);
  });

  it('returns taxFreeTradeCount = 0 when no haltefrist-met consumptions exist', () => {
    db.insert(taxSummaries).values(makeTaxSummary()).run();
    const result = generator.generate(2024);
    expect(result?.spotSummary.taxFreeTradeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: FuturesSummary — correct Abgeltungssteuer calculation
// ---------------------------------------------------------------------------

describe('Scenario 3: FuturesSummary correct Abgeltungssteuer', () => {
  it('maps all fields from tax_summaries futures_pnl row', () => {
    // Also seed a private_sale to ensure guard passes
    db.insert(taxSummaries)
      .values([
        makeTaxSummary({
          bucket: 'private_sale',
          totalGainsEur: '0',
          netEur: '0',
          taxableAmountEur: '0',
        }),
        makeTaxSummary({
          bucket: 'futures_pnl',
          totalGainsEur: '2000',
          totalLossesEur: '-500',
          netEur: '1500',
          taxableAmountEur: '1500',
          estimatedTaxEur: '395.625', // 1500 * 0.26375
          tradeCount: 5,
        }),
      ])
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const futures = result?.futuresSummary;
    expect(futures.totalGainsEur).toBe('2000');
    expect(futures.totalLossesEur).toBe('-500');
    expect(futures.netEur).toBe('1500');
    expect(futures.taxableAmountEur).toBe('1500');
    expect(futures.estimatedTaxEur).toBe('395.625');
    expect(futures.tradeCount).toBe(5);
  });

  it('sums totalFeesEur from futures_positions for the year', () => {
    // Insert a futures-only summary (guard: must have at least one row for year)
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({
          bucket: 'futures_pnl',
          totalGainsEur: '1000',
          netEur: '800',
          taxableAmountEur: '800',
          estimatedTaxEur: '211',
        })
      )
      .run();

    // Insert futures_positions with fees
    const tx1 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'futures_close_long' }))
      .returning({ id: transactions.id })
      .get();
    const tx2 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'futures_close_long' }))
      .returning({ id: transactions.id })
      .get();

    db.insert(futuresPositions)
      .values([
        {
          symbol: 'BTCUSDT',
          realizedPnlEur: '600',
          feeEur: '10',
          transactionId: tx1.id,
          taxYear: 2024,
        },
        {
          symbol: 'ETHUSDT',
          realizedPnlEur: '400',
          feeEur: '15.5',
          transactionId: tx2.id,
          taxYear: 2024,
        },
      ])
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();
    // totalFees = 10 + 15.5 = 25.5
    expect(parseFloat(result?.futuresSummary.totalFeesEur)).toBeCloseTo(25.5, 5);
  });

  it('returns totalFeesEur = "0" when no futures_positions exist', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ bucket: 'futures_pnl' }))
      .run();
    const result = generator.generate(2024);
    expect(parseFloat(result?.futuresSummary.totalFeesEur)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: EarnSummary — per-coin breakdown and Freigrenze
// ---------------------------------------------------------------------------

describe('Scenario 4: EarnSummary per-coin breakdown and Freigrenze', () => {
  it('builds perCoinBreakdown with totals and counts', () => {
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({
          bucket: 'staking_earn',
          totalGainsEur: '500',
          netEur: '500',
          taxableAmountEur: '0',
          tradeCount: 3,
        })
      )
      .run();

    const tx1 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'earn_interest', symbol: 'ETH' }))
      .returning({ id: transactions.id })
      .get();
    const tx2 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'earn_interest', symbol: 'ETH' }))
      .returning({ id: transactions.id })
      .get();
    const tx3 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'earn_deposit', symbol: 'SOL' }))
      .returning({ id: transactions.id })
      .get();

    db.insert(earnIncome)
      .values([
        {
          symbol: 'ETH',
          amount: '0.1',
          eurValueAtReceipt: '300',
          receivedAt: '2024-03-01T00:00:00.000Z',
          transactionId: tx1.id,
          taxYear: 2024,
        },
        {
          symbol: 'ETH',
          amount: '0.05',
          eurValueAtReceipt: '150',
          receivedAt: '2024-06-01T00:00:00.000Z',
          transactionId: tx2.id,
          taxYear: 2024,
        },
        {
          symbol: 'SOL',
          amount: '2',
          eurValueAtReceipt: '50',
          receivedAt: '2024-09-01T00:00:00.000Z',
          transactionId: tx3.id,
          taxYear: 2024,
        },
      ])
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const earn = result?.earnSummary;
    expect(parseFloat(earn.totalIncomeEur)).toBeCloseTo(500, 5);
    expect(earn.recordCount).toBe(3);
    expect(earn.freigrenzeLimitEur).toBe('256');
    // 500 > 256 → over
    expect(earn.freigrenzeStatus).toBe('over');

    expect(earn.perCoinBreakdown).toHaveLength(2);
    // Sorted by symbol ASC: ETH, SOL
    const eth = earn.perCoinBreakdown.find((c) => c.symbol === 'ETH');
    const sol = earn.perCoinBreakdown.find((c) => c.symbol === 'SOL');

    expect(eth).toBeDefined();
    expect(parseFloat(eth?.totalEur)).toBeCloseTo(450, 5);
    expect(eth?.count).toBe(2);

    expect(sol).toBeDefined();
    expect(parseFloat(sol?.totalEur)).toBeCloseTo(50, 5);
    expect(sol?.count).toBe(1);
  });

  it('sets freigrenzeStatus = "under" when totalIncomeEur <= 256', () => {
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({
          bucket: 'staking_earn',
          totalGainsEur: '100',
          netEur: '100',
          tradeCount: 1,
        })
      )
      .run();

    const tx = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'earn_interest', symbol: 'ETH' }))
      .returning({ id: transactions.id })
      .get();
    db.insert(earnIncome)
      .values({
        symbol: 'ETH',
        amount: '1',
        eurValueAtReceipt: '100',
        receivedAt: '2024-01-01T00:00:00.000Z',
        transactionId: tx.id,
        taxYear: 2024,
      })
      .run();

    const result = generator.generate(2024);
    expect(result?.earnSummary.freigrenzeStatus).toBe('under');
  });

  it('returns empty perCoinBreakdown when no earn_income rows exist', () => {
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({ bucket: 'staking_earn', totalGainsEur: '0', netEur: '0', tradeCount: 0 })
      )
      .run();

    const result = generator.generate(2024);
    expect(result?.earnSummary.perCoinBreakdown).toHaveLength(0);
    expect(parseFloat(result?.earnSummary.totalIncomeEur)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: TradeAppendix — includes haltefrist-met and non-met rows
// ---------------------------------------------------------------------------

describe('Scenario 5: TradeAppendix includes both haltefrist-met and non-met rows', () => {
  it('includes all lot consumptions regardless of haltefristMet value', () => {
    db.insert(taxSummaries).values(makeTaxSummary()).run();

    // Two buy transactions
    const buy1 = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'buy',
          tradedAt: '2022-01-01T00:00:00.000Z',
          taxYear: 2022,
        })
      )
      .returning({ id: transactions.id })
      .get();
    const buy2 = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'buy', tradedAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: transactions.id })
      .get();

    // One sell transaction
    const sell = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          amount: '2',
          tradedAt: '2024-08-01T00:00:00.000Z',
        })
      )
      .returning({ id: transactions.id })
      .get();

    // Two lots
    const lot1 = db
      .insert(fifoLots)
      .values(makeLot(buy1.id, { acquiredAt: '2022-01-01T00:00:00.000Z', taxYear: 2022 }))
      .returning({ id: fifoLots.id })
      .get();
    const lot2 = db
      .insert(fifoLots)
      .values(makeLot(buy2.id, { acquiredAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: fifoLots.id })
      .get();

    // One haltefrist-met consumption, one non-met
    db.insert(lotConsumptions)
      .values([
        {
          lotId: lot1.id,
          sellTransactionId: sell.id,
          amountConsumed: '1',
          costBasisEur: '40000',
          proceedsEur: '50000',
          gainLossEur: '10000',
          feeEur: '0',
          heldDays: 943,
          haltefristMet: true,
          taxYear: 2024,
        },
        {
          lotId: lot2.id,
          sellTransactionId: sell.id,
          amountConsumed: '1',
          costBasisEur: '40000',
          proceedsEur: '50000',
          gainLossEur: '10000',
          feeEur: '0',
          heldDays: 213,
          haltefristMet: false,
          taxYear: 2024,
        },
      ])
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const appendix = result?.tradeAppendix;
    expect(appendix).toHaveLength(2);

    const taxFreeRow = appendix.find((r) => r.haltefristMet === true);
    const taxableRow = appendix.find((r) => r.haltefristMet === false);

    expect(taxFreeRow).toBeDefined();
    expect(taxFreeRow?.heldDays).toBe(943);
    expect(taxFreeRow?.costBasisEur).toBe('40000');
    expect(taxFreeRow?.proceedsEur).toBe('50000');
    expect(taxFreeRow?.gainLossEur).toBe('10000');
    expect(taxFreeRow?.exchange).toBe('bitget');

    expect(taxableRow).toBeDefined();
    expect(taxableRow?.heldDays).toBe(213);
    expect(taxableRow?.haltefristMet).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: TradeAppendix sorting — by sell date ASC then symbol ASC
// ---------------------------------------------------------------------------

describe('Scenario 6: TradeAppendix sorted by sellDate ASC then symbol ASC', () => {
  it('orders rows by tradedAt ascending, then symbol ascending', () => {
    db.insert(taxSummaries).values(makeTaxSummary()).run();

    // Sell 1: later date
    const sellLate = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          symbol: 'BTC',
          tradedAt: '2024-12-01T00:00:00.000Z',
        })
      )
      .returning({ id: transactions.id })
      .get();

    // Sell 2: earlier date, two coins (ETH comes before SOL alphabetically)
    const sellEarlyEth = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          symbol: 'ETH',
          tradedAt: '2024-03-01T00:00:00.000Z',
        })
      )
      .returning({ id: transactions.id })
      .get();
    const sellEarlySol = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          symbol: 'SOL',
          tradedAt: '2024-03-01T00:00:00.000Z',
        })
      )
      .returning({ id: transactions.id })
      .get();

    // Buys for each
    const buyBtc = db
      .insert(transactions)
      .values(makeTransaction({ symbol: 'BTC', tradedAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: transactions.id })
      .get();
    const buyEth = db
      .insert(transactions)
      .values(makeTransaction({ symbol: 'ETH', tradedAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: transactions.id })
      .get();
    const buySol = db
      .insert(transactions)
      .values(makeTransaction({ symbol: 'SOL', tradedAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: transactions.id })
      .get();

    // Lots
    const lotBtc = db
      .insert(fifoLots)
      .values(makeLot(buyBtc.id, { symbol: 'BTC', acquiredAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: fifoLots.id })
      .get();
    const lotEth = db
      .insert(fifoLots)
      .values(makeLot(buyEth.id, { symbol: 'ETH', acquiredAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: fifoLots.id })
      .get();
    const lotSol = db
      .insert(fifoLots)
      .values(makeLot(buySol.id, { symbol: 'SOL', acquiredAt: '2024-01-01T00:00:00.000Z' }))
      .returning({ id: fifoLots.id })
      .get();

    // Consumptions — insert in deliberately wrong order
    db.insert(lotConsumptions)
      .values([
        {
          lotId: lotBtc.id,
          sellTransactionId: sellLate.id,
          amountConsumed: '1',
          costBasisEur: '40000',
          proceedsEur: '50000',
          gainLossEur: '10000',
          feeEur: '0',
          heldDays: 335,
          haltefristMet: false,
          taxYear: 2024,
        },
        {
          lotId: lotSol.id,
          sellTransactionId: sellEarlySol.id,
          amountConsumed: '1',
          costBasisEur: '100',
          proceedsEur: '150',
          gainLossEur: '50',
          feeEur: '0',
          heldDays: 60,
          haltefristMet: false,
          taxYear: 2024,
        },
        {
          lotId: lotEth.id,
          sellTransactionId: sellEarlyEth.id,
          amountConsumed: '1',
          costBasisEur: '3000',
          proceedsEur: '3500',
          gainLossEur: '500',
          feeEur: '0',
          heldDays: 60,
          haltefristMet: false,
          taxYear: 2024,
        },
      ])
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const appendix = result?.tradeAppendix;
    expect(appendix).toHaveLength(3);

    // First two rows: March sells (same date), ETH before SOL alphabetically
    expect(appendix[0].symbol).toBe('ETH');
    expect(appendix[0].sellDate).toBe('2024-03-01T00:00:00.000Z');

    expect(appendix[1].symbol).toBe('SOL');
    expect(appendix[1].sellDate).toBe('2024-03-01T00:00:00.000Z');

    // Third row: December sell (BTC)
    expect(appendix[2].symbol).toBe('BTC');
    expect(appendix[2].sellDate).toBe('2024-12-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Missing bucket returns zero-valued summary (not null/undefined)
// ---------------------------------------------------------------------------

describe('Scenario 7: Missing buckets return zero-valued summaries', () => {
  it('returns zero-valued FuturesSummary when no futures_pnl bucket exists', () => {
    // Only private_sale in tax_summaries
    db.insert(taxSummaries)
      .values(makeTaxSummary({ bucket: 'private_sale' }))
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const futures = result?.futuresSummary;
    expect(futures).toBeDefined();
    expect(futures.totalGainsEur).toBe('0');
    expect(futures.totalLossesEur).toBe('0');
    expect(futures.netEur).toBe('0');
    expect(futures.taxableAmountEur).toBe('0');
    expect(futures.estimatedTaxEur).toBe('0');
    expect(futures.tradeCount).toBe(0);
    expect(parseFloat(futures.totalFeesEur)).toBe(0);
  });

  it('returns zero-valued EarnSummary when no staking_earn bucket exists', () => {
    db.insert(taxSummaries)
      .values(makeTaxSummary({ bucket: 'private_sale' }))
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const earn = result?.earnSummary;
    expect(earn).toBeDefined();
    expect(parseFloat(earn.totalIncomeEur)).toBe(0);
    expect(earn.recordCount).toBe(0);
    expect(earn.perCoinBreakdown).toHaveLength(0);
    expect(earn.freigrenzeStatus).toBe('under');
    expect(earn.freigrenzeLimitEur).toBe('256');
  });

  it('returns zero-valued SpotSummary when no private_sale bucket exists', () => {
    // Only futures_pnl
    db.insert(taxSummaries)
      .values(
        makeTaxSummary({
          bucket: 'futures_pnl',
          totalGainsEur: '1000',
          netEur: '1000',
          taxableAmountEur: '1000',
        })
      )
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();

    const spot = result?.spotSummary;
    expect(spot).toBeDefined();
    expect(spot.totalGainsEur).toBe('0');
    expect(spot.netEur).toBe('0');
    expect(spot.tradeCount).toBe(0);
    expect(spot.taxFreeTradeCount).toBe(0);
    expect(spot.freigrenzeStatus).toBe('under');
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Mixed year — all three buckets simultaneously
// ---------------------------------------------------------------------------

describe('Scenario 8: Mixed year — all three buckets', () => {
  it('returns correctly populated ReportData with all three summaries', () => {
    // Insert all three tax summary buckets
    db.insert(taxSummaries)
      .values([
        makeTaxSummary({
          bucket: 'private_sale',
          totalGainsEur: '3000',
          totalLossesEur: '-500',
          netEur: '2500',
          taxableAmountEur: '2500',
          tradeCount: 4,
        }),
        makeTaxSummary({
          bucket: 'futures_pnl',
          totalGainsEur: '1500',
          totalLossesEur: '-300',
          netEur: '1200',
          taxableAmountEur: '1200',
          estimatedTaxEur: '316.5', // 1200 * 0.26375
          tradeCount: 2,
        }),
        makeTaxSummary({
          bucket: 'staking_earn',
          totalGainsEur: '300',
          netEur: '300',
          taxableAmountEur: '300',
          tradeCount: 5,
        }),
      ])
      .run();

    // Insert earn income for perCoinBreakdown
    const earnTx = db
      .insert(transactions)
      .values(makeTransaction({ canonicalType: 'earn_interest', symbol: 'DOT' }))
      .returning({ id: transactions.id })
      .get();
    db.insert(earnIncome)
      .values({
        symbol: 'DOT',
        amount: '10',
        eurValueAtReceipt: '300',
        receivedAt: '2024-05-01T00:00:00.000Z',
        transactionId: earnTx.id,
        taxYear: 2024,
      })
      .run();

    const result = generator.generate(2024);
    expect(result).not.toBeNull();
    expect(result?.taxYear).toBe(2024);
    expect(typeof result?.generatedAt).toBe('string');

    // Spot
    expect(result?.spotSummary.totalGainsEur).toBe('3000');
    expect(result?.spotSummary.netEur).toBe('2500');
    expect(result?.spotSummary.freigrenzeStatus).toBe('over');
    expect(result?.spotSummary.tradeCount).toBe(4);

    // Futures
    expect(result?.futuresSummary.netEur).toBe('1200');
    expect(result?.futuresSummary.estimatedTaxEur).toBe('316.5');
    expect(result?.futuresSummary.tradeCount).toBe(2);

    // Earn
    expect(parseFloat(result?.earnSummary.totalIncomeEur)).toBeCloseTo(300, 5);
    expect(result?.earnSummary.freigrenzeStatus).toBe('over');
    expect(result?.earnSummary.perCoinBreakdown).toHaveLength(1);
    expect(result?.earnSummary.perCoinBreakdown[0].symbol).toBe('DOT');

    // No consumptions seeded → empty appendix
    expect(result?.tradeAppendix).toHaveLength(0);
  });

  it('includes complete TradeAppendixRow fields for each row', () => {
    db.insert(taxSummaries).values(makeTaxSummary()).run();

    const buyTx = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'buy',
          tradedAt: '2024-01-01T00:00:00.000Z',
          exchange: 'bitget',
        })
      )
      .returning({ id: transactions.id })
      .get();
    const sellTx = db
      .insert(transactions)
      .values(
        makeTransaction({
          canonicalType: 'sell',
          side: 'sell',
          tradedAt: '2024-09-15T00:00:00.000Z',
          exchange: 'bitget',
        })
      )
      .returning({ id: transactions.id })
      .get();

    const lot = db
      .insert(fifoLots)
      .values(
        makeLot(buyTx.id, {
          symbol: 'BTC',
          acquiredAt: '2024-01-01T00:00:00.000Z',
          originalAmount: '0.5',
          remainingAmount: '0',
          costBasisEur: '20000',
          costPerUnitEur: '40000',
          feeEur: '5',
        })
      )
      .returning({ id: fifoLots.id })
      .get();

    db.insert(lotConsumptions)
      .values({
        lotId: lot.id,
        sellTransactionId: sellTx.id,
        amountConsumed: '0.5',
        costBasisEur: '20000',
        proceedsEur: '25000',
        gainLossEur: '5000',
        feeEur: '10',
        heldDays: 258,
        haltefristMet: false,
        taxYear: 2024,
      })
      .run();

    const result = generator.generate(2024);
    const row = result?.tradeAppendix[0];

    expect(row.symbol).toBe('BTC');
    expect(row.buyDate).toBe('2024-01-01T00:00:00.000Z');
    expect(row.sellDate).toBe('2024-09-15T00:00:00.000Z');
    expect(row.amountConsumed).toBe('0.5');
    expect(row.costBasisEur).toBe('20000');
    expect(row.proceedsEur).toBe('25000');
    expect(row.gainLossEur).toBe('5000');
    expect(row.feeEur).toBe('10');
    expect(row.heldDays).toBe(258);
    expect(row.haltefristMet).toBe(false);
    expect(row.exchange).toBe('bitget');
    expect(typeof row.id).toBe('number');
    expect(typeof row.sellTransactionId).toBe('number');
  });
});
