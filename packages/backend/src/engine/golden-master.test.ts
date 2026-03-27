/**
 * Golden Master Tests — Hand-Verified Tax Scenarios
 *
 * Each test sets up an in-memory SQLite database with a known transaction set,
 * runs `runTaxCalculation(db)`, and verifies exact numeric results against
 * hand-calculated expected values.
 *
 * Scenarios:
 *   1. Three BTC buys, partial sell crossing two lots with Haltefrist boundary
 *   2. Freigrenze cliff boundary values (999.99, 1000.00, 1000.01)
 *   3. Three-bucket isolation (spot + futures + earn produce separate summaries)
 *   4. NULL price gate blocks execution (derived tables stay empty)
 *   5. Idempotent re-run produces identical results
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
import { runTaxCalculation } from './tax-calculator.js';

// ---------------------------------------------------------------------------
// Migration helper
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
let checksumCounter = 0;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  checksumCounter = 0;
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeTxInsert(overrides: Partial<typeof transactions.$inferInsert> = {}) {
  checksumCounter += 1;
  return {
    exchange: 'bitget',
    sourceType: 'spot_tx',
    canonicalType: 'buy',
    symbol: 'BTC',
    side: 'buy',
    amount: '1',
    price: '50000',
    fee: '0',
    totalValue: '50000',
    tradedAt: '2024-01-01T00:00:00.000Z',
    taxYear: 2024,
    checksum: `golden-${checksumCounter}`,
    importedAt: new Date().toISOString(),
    eurPrice: '50000',
    ...overrides,
  } as typeof transactions.$inferInsert;
}

// ---------------------------------------------------------------------------
// Scenario 1: Three buys + partial sell crossing two lots, Haltefrist boundary
// ---------------------------------------------------------------------------
//
// Setup (no fees for clarity):
//   Lot A: Buy 0.5 BTC on 2023-06-01 at eurPrice=25000  → costPerUnit = 25000
//   Lot B: Buy 0.3 BTC on 2024-01-15 at eurPrice=40000  → costPerUnit = 40000
//   Lot C: Buy 0.2 BTC on 2024-07-01 at eurPrice=55000  → costPerUnit = 55000
//   Sell  0.7 BTC on 2024-08-01 at eurPrice=60000
//
// FIFO consumption (oldest first):
//   Lot A (0.5 BTC consumed):
//     heldDays = differenceInCalendarDays(2024-08-01, 2023-06-01)
//              = 427 days  →  haltefristMet = true (≥366)  →  TAX-FREE
//     proceeds  = 0.5 × 60000 = 30000
//     costBasis = 0.5 × 25000 = 12500
//     gainLoss  = 30000 − 12500 = 17500  (not taxable, haltefrist-met)
//
//   Lot B (0.2 BTC consumed — only 0.2 needed out of 0.3):
//     heldDays = differenceInCalendarDays(2024-08-01, 2024-01-15)
//              = 199 days  →  haltefristMet = false  →  TAXABLE
//     proceeds  = 0.2 × 60000 = 12000
//     costBasis = 0.2 × 40000 =  8000
//     gainLoss  = 12000 −  8000 =  4000
//
//   Lot B remaining: 0.1 BTC  |  Lot C: 0.2 BTC untouched
//
// Spot tax (year 2024):
//   totalGains = 4000 (haltefristMet=false, gain>0)
//   totalLosses = 0
//   netGain = 4000  >  1000 Freigrenze  →  taxableAmountEur = 4000

describe('Scenario 1: Three BTC buys, partial sell crossing two lots + Haltefrist', () => {
  it('produces correct lot counts, consumptions, and taxable gain for 2024', () => {
    db.insert(transactions)
      .values([
        // Lot A — acquired 2023, Haltefrist met at sell date
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '0.5',
          price: '25000',
          totalValue: '12500',
          eurPrice: '25000',
          tradedAt: '2023-06-01T00:00:00.000Z',
          taxYear: 2023,
        }),
        // Lot B — acquired Jan 2024, Haltefrist NOT met at sell date
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '0.3',
          price: '40000',
          totalValue: '12000',
          eurPrice: '40000',
          tradedAt: '2024-01-15T00:00:00.000Z',
          taxYear: 2024,
        }),
        // Lot C — acquired Jul 2024, untouched by the sell
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '0.2',
          price: '55000',
          totalValue: '11000',
          eurPrice: '55000',
          tradedAt: '2024-07-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        // Sell 0.7 BTC on 2024-08-01
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '0.7',
          price: '60000',
          totalValue: '42000',
          eurPrice: '60000',
          tradedAt: '2024-08-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);

    // No errors
    expect(result.errors).toHaveLength(0);

    // Three FIFO lots created (A, B, C)
    const lots = db.select().from(fifoLots).all();
    expect(lots).toHaveLength(3);

    // Lot A: costPerUnit = 25000, remaining = 0 (fully consumed)
    const lotA = lots.find((l) => l.costPerUnitEur === '25000');
    expect(lotA).toBeDefined();
    expect(lotA?.originalAmount).toBe('0.5');
    expect(lotA?.remainingAmount).toBe('0');

    // Lot B: costPerUnit = 40000, remaining = 0.1 (only 0.2 consumed)
    const lotB = lots.find((l) => l.costPerUnitEur === '40000');
    expect(lotB).toBeDefined();
    expect(lotB?.originalAmount).toBe('0.3');
    expect(lotB?.remainingAmount).toBe('0.1');

    // Lot C: costPerUnit = 55000, untouched
    const lotC = lots.find((l) => l.costPerUnitEur === '55000');
    expect(lotC).toBeDefined();
    expect(lotC?.remainingAmount).toBe('0.2');

    // Two lot consumptions: Lot A (0.5 BTC) and Lot B (0.2 BTC)
    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(2);

    // Lot A consumption: haltefrist met (427 days)
    const consumptionA = consumptions.find((c) => c.lotId === lotA?.id);
    expect(consumptionA).toBeDefined();
    expect(consumptionA?.haltefristMet).toBe(true);
    expect(consumptionA?.heldDays).toBe(427);
    expect(consumptionA?.amountConsumed).toBe('0.5');
    expect(consumptionA?.proceedsEur).toBe('30000');
    expect(consumptionA?.costBasisEur).toBe('12500');
    // gainLoss = 30000 - 12500 = 17500
    expect(consumptionA?.gainLossEur).toBe('17500');

    // Lot B consumption: haltefrist NOT met (199 days)
    const consumptionB = consumptions.find((c) => c.lotId === lotB?.id);
    expect(consumptionB).toBeDefined();
    expect(consumptionB?.haltefristMet).toBe(false);
    expect(consumptionB?.heldDays).toBe(199);
    expect(consumptionB?.amountConsumed).toBe('0.2');
    expect(consumptionB?.proceedsEur).toBe('12000');
    expect(consumptionB?.costBasisEur).toBe('8000');
    // gainLoss = 12000 - 8000 = 4000
    expect(consumptionB?.gainLossEur).toBe('4000');

    // Tax summary for 2024 private_sale
    const summaries = db.select().from(taxSummaries).all();
    const privateSale2024 = summaries.find(
      (s) => s.bucket === 'private_sale' && s.taxYear === 2024
    );
    expect(privateSale2024).toBeDefined();

    // Only Lot B gain (haltefristMet=false) enters the net calculation
    // totalGains = 4000, totalLosses = 0, netGain = 4000 > 1000 Freigrenze
    expect(privateSale2024?.taxableAmountEur).toBe('4000');
    expect(privateSale2024?.totalGainsEur).toBe('4000');
    // Tax-free gain from Lot A is not in totalGainsEur (only taxable gains counted)
    expect(privateSale2024?.totalLossesEur).toBe('0');
    expect(privateSale2024?.tradeCount).toBe(2); // 2 lot consumptions (1 sell × 2 lots)

    // No errors, no sellsWithoutLots
    expect(result.fifo.sellsWithoutLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Freigrenze cliff boundary values
// ---------------------------------------------------------------------------
//
// The Freigrenze cliff for §23 private sales is 1000 EUR.
// Rule: if netGain > 1000 → taxable = netGain, else taxable = 0
//
// Three sub-cases tested:
//   a) netGain = 999.99  → taxable = 0      (below cliff)
//   b) netGain = 1000.00 → taxable = 0      (exactly at cliff, NOT exceeded)
//   c) netGain = 1000.01 → taxable = 1000.01 (exceeds cliff → full amount)

describe('Scenario 2: Freigrenze cliff boundary values', () => {
  /**
   * Helper: build a buy + sell pair that produces a specific net gain.
   * Buy 1 unit at buyPrice, sell 1 unit at sellPrice → gain = sellPrice - buyPrice.
   * Uses a fixed date span of < 366 days so haltefrist is NOT met (taxable).
   */
  function insertBuySellPair(targetGain: number, symbol: string) {
    const buyPrice = 10000;
    const sellPrice = buyPrice + targetGain;

    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol,
          amount: '1',
          price: String(buyPrice),
          totalValue: String(buyPrice),
          eurPrice: String(buyPrice),
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol,
          side: 'sell',
          amount: '1',
          price: String(sellPrice),
          totalValue: String(sellPrice),
          eurPrice: String(sellPrice),
          tradedAt: '2024-06-01T00:00:00.000Z', // 152 days < 366 → haltefrist not met
          taxYear: 2024,
        }),
      ])
      .run();
  }

  it('a) net gain 999.99 EUR → taxableAmountEur = 0 (below cliff)', () => {
    insertBuySellPair(999.99, 'AAA');

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2024);
    expect(privateSale).toBeDefined();
    expect(privateSale?.taxableAmountEur).toBe('0');
    expect(Number(privateSale?.netEur)).toBeCloseTo(999.99, 2);
  });

  it('b) net gain 1000.00 EUR → taxableAmountEur = 0 (exactly at cliff, not exceeded)', () => {
    insertBuySellPair(1000.0, 'BBB');

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2024);
    expect(privateSale).toBeDefined();
    // netGain = 1000.00, Freigrenze = 1000.00 → NOT greater than → taxable = 0
    expect(privateSale?.taxableAmountEur).toBe('0');
    expect(Number(privateSale?.netEur)).toBeCloseTo(1000.0, 2);
  });

  it('c) net gain 1000.01 EUR → taxableAmountEur = 1000.01 (exceeds cliff → full amount)', () => {
    insertBuySellPair(1000.01, 'CCC');

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2024);
    expect(privateSale).toBeDefined();
    // netGain = 1000.01 > 1000 Freigrenze → full amount is taxable (cliff, not deduction)
    expect(Number(privateSale?.taxableAmountEur)).toBeCloseTo(1000.01, 2);
    expect(Number(privateSale?.netEur)).toBeCloseTo(1000.01, 2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Three-bucket isolation (spot + futures + earn)
// ---------------------------------------------------------------------------
//
// Verifies that spot, futures, and earn transactions produce independent
// tax_summaries rows with no cross-contamination.

describe('Scenario 3: Three-bucket isolation', () => {
  it('spot + futures + earn produce 3 separate tax_summaries with no cross-contamination', () => {
    db.insert(transactions)
      .values([
        // --- Spot (private_sale bucket) ---
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'ETH',
          amount: '2',
          price: '3000',
          totalValue: '6000',
          eurPrice: '3000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'ETH',
          side: 'sell',
          amount: '2',
          price: '4000',
          totalValue: '8000',
          eurPrice: '4000',
          tradedAt: '2024-08-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        // --- Futures (futures_pnl bucket) ---
        makeTxInsert({
          sourceType: 'futures_tx',
          canonicalType: 'futures_close_long',
          symbol: 'ETHUSDT',
          side: 'sell',
          amount: '500', // 500 EUR P&L
          price: '0',
          totalValue: '500',
          eurPrice: '1',
          tradedAt: '2024-04-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        // --- Earn (staking_earn bucket) ---
        makeTxInsert({
          sourceType: 'earn',
          canonicalType: 'earn_interest',
          symbol: 'ETH',
          side: null,
          amount: '0.1',
          price: '0',
          totalValue: '0',
          eurPrice: '3500',
          tradedAt: '2024-05-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const summaries = db.select().from(taxSummaries).all();
    expect(summaries).toHaveLength(3);

    const buckets = summaries.map((s) => s.bucket).sort();
    expect(buckets).toEqual(['futures_pnl', 'private_sale', 'staking_earn']);

    // --- Spot: net gain = (2 × 4000) - (2 × 3000) = 8000 - 6000 = 2000 EUR ---
    const spotSummary = summaries.find((s) => s.bucket === 'private_sale');
    expect(spotSummary).toBeDefined();
    expect(spotSummary?.taxYear).toBe(2024);
    // 2000 > 1000 Freigrenze → taxable
    expect(Number(spotSummary?.taxableAmountEur)).toBeCloseTo(2000, 2);
    // No futures/earn contamination in spot totals
    expect(Number(spotSummary?.totalGainsEur)).toBeCloseTo(2000, 2);

    // --- Futures: single position P&L = 500 EUR, no Freigrenze ---
    const futuresSummary = summaries.find((s) => s.bucket === 'futures_pnl');
    expect(futuresSummary).toBeDefined();
    expect(futuresSummary?.taxYear).toBe(2024);
    expect(Number(futuresSummary?.taxableAmountEur)).toBeCloseTo(500, 2);
    // Abgeltungssteuer = 500 × 26.375% = 131.875 EUR
    expect(Number(futuresSummary?.estimatedTaxEur)).toBeCloseTo(131.875, 2);

    // --- Earn: 0.1 ETH × 3500 EUR = 350 EUR > 256 Freigrenze → fully taxable ---
    const earnSummary = summaries.find((s) => s.bucket === 'staking_earn');
    expect(earnSummary).toBeDefined();
    expect(earnSummary?.taxYear).toBe(2024);
    expect(Number(earnSummary?.totalGainsEur)).toBeCloseTo(350, 2);
    // 350 > 256 EUR Freigrenze → taxable = full amount
    expect(Number(earnSummary?.taxableAmountEur)).toBeCloseTo(350, 2);

    // No cross-contamination: each summary belongs to exactly one bucket
    const privateSaleRow = summaries.find((s) => s.bucket === 'private_sale');
    const futuresPnlRow = summaries.find((s) => s.bucket === 'futures_pnl');
    const stakingEarnRow = summaries.find((s) => s.bucket === 'staking_earn');
    expect(privateSaleRow).toBeDefined();
    expect(futuresPnlRow).toBeDefined();
    expect(stakingEarnRow).toBeDefined();

    // Spot does not include futures P&L
    expect(Number(privateSaleRow?.totalGainsEur)).not.toBeCloseTo(
      Number(futuresPnlRow?.totalGainsEur),
      0
    );

    // Verify earn FIFO lot created
    const earnLots = db.select().from(earnIncome).all();
    expect(earnLots).toHaveLength(1);
    expect(earnLots[0].symbol).toBe('ETH');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: NULL price gate blocks execution
// ---------------------------------------------------------------------------
//
// If any taxable transaction has eurPrice = null, the engine returns an error
// result immediately without writing to derived tables.

describe('Scenario 4: NULL price gate blocks execution', () => {
  it('buy with eurPrice=null triggers error result and derived tables remain empty', () => {
    db.insert(transactions)
      .values(
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          eurPrice: null,
          tradedAt: '2024-03-01T00:00:00.000Z',
          taxYear: 2024,
        })
      )
      .run();

    const result = runTaxCalculation(db);

    // Error returned
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/Missing EUR price/);

    // All derived tables must remain empty
    expect(db.select().from(fifoLots).all()).toHaveLength(0);
    expect(db.select().from(lotConsumptions).all()).toHaveLength(0);
    expect(db.select().from(futuresPositions).all()).toHaveLength(0);
    expect(db.select().from(earnIncome).all()).toHaveLength(0);
    expect(db.select().from(taxSummaries).all()).toHaveLength(0);

    // Engine result arrays must be empty
    expect(result.fifo.lots).toHaveLength(0);
    expect(result.fifo.consumptions).toHaveLength(0);
    expect(result.summaries).toHaveLength(0);
    expect(result.futures.positions).toHaveLength(0);
    expect(result.earn.incomeRecords).toHaveLength(0);
  });

  it('sell with eurPrice=null triggers error, buy-only transactions do not proceed', () => {
    db.insert(transactions)
      .values([
        // This buy has a valid price
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'ETH',
          amount: '1',
          eurPrice: '3000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        // This sell is missing its EUR price
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'ETH',
          side: 'sell',
          amount: '1',
          eurPrice: null,
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/Missing EUR price/);
    expect(db.select().from(fifoLots).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Idempotent re-run produces identical results
// ---------------------------------------------------------------------------
//
// The engine uses truncate-and-recompute semantics: running it twice must
// produce the same DB state and the same in-memory results.

describe('Scenario 5: Idempotent re-run', () => {
  it('running runTaxCalculation twice produces identical DB state and results', () => {
    // Use the same Scenario 1 setup for a meaningful idempotency check
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '0.5',
          price: '25000',
          totalValue: '12500',
          eurPrice: '25000',
          tradedAt: '2023-06-01T00:00:00.000Z',
          taxYear: 2023,
        }),
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '0.3',
          price: '40000',
          totalValue: '12000',
          eurPrice: '40000',
          tradedAt: '2024-01-15T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '0.5',
          price: '60000',
          totalValue: '30000',
          eurPrice: '60000',
          tradedAt: '2024-08-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    // First run
    const result1 = runTaxCalculation(db);
    const lots1 = db.select().from(fifoLots).all();
    const consumptions1 = db.select().from(lotConsumptions).all();
    const summaries1 = db.select().from(taxSummaries).all();

    // Second run — must truncate and recompute
    const result2 = runTaxCalculation(db);
    const lots2 = db.select().from(fifoLots).all();
    const consumptions2 = db.select().from(lotConsumptions).all();
    const summaries2 = db.select().from(taxSummaries).all();

    // Same number of rows (not doubled)
    expect(lots2).toHaveLength(lots1.length);
    expect(consumptions2).toHaveLength(consumptions1.length);
    expect(summaries2).toHaveLength(summaries1.length);

    // Same in-memory result structure
    expect(result2.fifo.lots.length).toBe(result1.fifo.lots.length);
    expect(result2.fifo.consumptions.length).toBe(result1.fifo.consumptions.length);
    expect(result2.summaries.length).toBe(result1.summaries.length);
    expect(result2.errors).toHaveLength(0);

    // Same taxable amounts
    for (let i = 0; i < summaries1.length; i++) {
      expect(summaries2[i].taxableAmountEur).toBe(summaries1[i].taxableAmountEur);
      expect(summaries2[i].totalGainsEur).toBe(summaries1[i].totalGainsEur);
      expect(summaries2[i].netEur).toBe(summaries1[i].netEur);
    }
  });

  it('multiple runs do not accumulate rows in derived tables', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          eurPrice: '50000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '1',
          eurPrice: '55000',
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    // Run 5 times
    for (let i = 0; i < 5; i++) {
      runTaxCalculation(db);
    }

    // Row counts must match a single run
    expect(db.select().from(fifoLots).all()).toHaveLength(1);
    expect(db.select().from(lotConsumptions).all()).toHaveLength(1);
    expect(db.select().from(taxSummaries).all()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Haltefrist exact boundary (365 days vs 366 days)
// ---------------------------------------------------------------------------
//
// HALTEFRIST_DAYS = 366. Conservative German tax interpretation.
// differenceInCalendarDays(sell, buy):
//   exactly 365 days → haltefristMet = false (< 366)
//   exactly 366 days → haltefristMet = true  (≥ 366)

describe('Scenario 6: Haltefrist exact boundary — 365 vs 366 days', () => {
  it('365 days held → haltefristMet = false (taxable)', () => {
    // Buy on 2024-01-01, sell on 2025-01-01 = 366 calendar days... let us pick
    // Buy on 2024-01-01, sell on 2024-12-31 = 365 days
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          eurPrice: '40000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '1',
          eurPrice: '50000',
          tradedAt: '2024-12-31T00:00:00.000Z', // 365 days after 2024-01-01
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].heldDays).toBe(365);
    expect(consumptions[0].haltefristMet).toBe(false); // 365 < 366

    // Gain = 10000, taxable (haltefrist not met, > Freigrenze)
    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale');
    expect(privateSale?.taxableAmountEur).toBe('10000');
  });

  it('366 days held → haltefristMet = true (tax-free)', () => {
    // Buy on 2024-01-01, sell on 2025-01-02 = 366 days (2024 is a leap year: 366 days in year)
    // Actually: differenceInCalendarDays(2025-01-01, 2024-01-01) = 366 (leap year)
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          eurPrice: '40000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '1',
          eurPrice: '50000',
          tradedAt: '2025-01-01T00:00:00.000Z', // 366 days after 2024-01-01 (leap year)
          taxYear: 2025,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);
    expect(result.errors).toHaveLength(0);

    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].heldDays).toBe(366);
    expect(consumptions[0].haltefristMet).toBe(true); // 366 >= 366

    // Tax-free: private_sale summary taxableAmountEur = 0
    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2025);
    expect(privateSale?.taxableAmountEur).toBe('0');
  });
});
