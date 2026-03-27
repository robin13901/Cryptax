/**
 * TaxCalculator Orchestrator — Integration Tests
 *
 * Tests the full pipeline: null-price gate → truncate → engine dispatch
 * → DB writes → tax summaries. Uses an in-memory SQLite database with
 * full migrations applied.
 *
 * Buckets under test:
 *   private_sale  → §23 EStG (FIFO spot + haltefrist)
 *   futures_pnl   → §20 EStG (abgeltungssteuer 26.375%)
 *   staking_earn  → §22 Nr. 3 EStG (256 EUR freigrenze cliff)
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
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// Fixtures
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
    checksum: `chk-${checksumCounter}-${Math.random()}`,
    importedAt: new Date().toISOString(),
    eurPrice: '50000',
    ...overrides,
  } as typeof transactions.$inferInsert;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTaxCalculation', () => {
  // -------------------------------------------------------------------------
  // Test 1: NULL price gate blocks execution
  // -------------------------------------------------------------------------
  it('NULL price gate blocks execution when a taxable transaction is missing EUR price', () => {
    db.insert(transactions)
      .values(makeTxInsert({ eurPrice: null }))
      .run();

    const result = runTaxCalculation(db);

    // Error result returned — no DB writes
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
    expect(result.summaries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Simple buy + sell produces correct FIFO lot and consumption
  // -------------------------------------------------------------------------
  it('simple buy+sell produces FIFO lot, consumption, and private_sale summary for 2024', () => {
    // Buy 1 BTC at 50000 EUR, sell 1 BTC at 60000 EUR — same year (no haltefrist)
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          price: '50000',
          eurPrice: '50000',
          tradedAt: '2024-01-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '1',
          price: '60000',
          totalValue: '60000',
          eurPrice: '60000',
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);

    // No errors
    expect(result.errors).toHaveLength(0);

    // FIFO lots: 1 lot for the buy
    const lots = db.select().from(fifoLots).all();
    expect(lots).toHaveLength(1);
    expect(lots[0].symbol).toBe('BTC');
    expect(lots[0].costPerUnitEur).toBe('50000');

    // Lot consumptions: 1 consumption
    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].taxYear).toBe(2024);
    expect(consumptions[0].haltefristMet).toBe(false); // ~151 days, < 366

    // Tax summaries: private_sale for 2024
    const summaries = db.select().from(taxSummaries).all();
    const privateSale = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2024);
    expect(privateSale).toBeDefined();
    // Net gain = 10000 EUR > 1000 EUR Freigrenze → taxable
    expect(privateSale?.taxableAmountEur).not.toBe('0');
  });

  // -------------------------------------------------------------------------
  // Test 3: Futures transactions produce section 20 summary
  // -------------------------------------------------------------------------
  it('futures_close_long produces futures_positions row and futures_pnl summary with Abgeltungssteuer', () => {
    db.insert(transactions)
      .values(
        makeTxInsert({
          sourceType: 'futures_tx',
          canonicalType: 'futures_close_long',
          symbol: 'BTCUSDT',
          side: 'buy',
          amount: '1000', // 1000 EUR realized P&L
          price: '0',
          totalValue: '1000',
          eurPrice: '1',
          tradedAt: '2024-03-15T00:00:00.000Z',
          taxYear: 2024,
        })
      )
      .run();

    const result = runTaxCalculation(db);

    expect(result.errors).toHaveLength(0);

    // futures_positions must have 1 row
    const positions = db.select().from(futuresPositions).all();
    expect(positions).toHaveLength(1);
    expect(positions[0].taxYear).toBe(2024);

    // Tax summaries must have futures_pnl for 2024
    const summaries = db.select().from(taxSummaries).all();
    const futuresSummary = summaries.find((s) => s.bucket === 'futures_pnl' && s.taxYear === 2024);
    expect(futuresSummary).toBeDefined();
    // 26.375% Abgeltungssteuer on net P&L of 1000 EUR = 263.75 EUR
    const estimatedTax = Number(futuresSummary?.estimatedTaxEur ?? '0');
    expect(estimatedTax).toBeCloseTo(263.75, 2);
  });

  // -------------------------------------------------------------------------
  // Test 4: Earn transactions produce income record + FIFO lot
  // -------------------------------------------------------------------------
  it('earn_interest produces earn_income row and a FIFO lot for the received coins', () => {
    db.insert(transactions)
      .values(
        makeTxInsert({
          sourceType: 'earn',
          canonicalType: 'earn_interest',
          symbol: 'ETH',
          side: null,
          amount: '1',
          price: '0',
          totalValue: '0',
          eurPrice: '3000',
          tradedAt: '2024-04-01T00:00:00.000Z',
          taxYear: 2024,
        })
      )
      .run();

    const result = runTaxCalculation(db);

    expect(result.errors).toHaveLength(0);

    // earn_income must have 1 row
    const earnRows = db.select().from(earnIncome).all();
    expect(earnRows).toHaveLength(1);
    expect(earnRows[0].symbol).toBe('ETH');
    expect(earnRows[0].eurValueAtReceipt).toBe('3000');
    expect(earnRows[0].taxYear).toBe(2024);

    // FIFO lot created for the earned ETH (for future disposal tracking)
    const lots = db.select().from(fifoLots).all();
    expect(lots).toHaveLength(1);
    expect(lots[0].symbol).toBe('ETH');
    expect(lots[0].costPerUnitEur).toBe('3000');
  });

  // -------------------------------------------------------------------------
  // Test 5: Three buckets are isolated — separate summary rows per bucket
  // -------------------------------------------------------------------------
  it('three buckets produce three separate tax_summaries rows', () => {
    db.insert(transactions)
      .values([
        // Spot: buy + sell (private_sale bucket)
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
          eurPrice: '60000',
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
        // Futures: futures_close_long (futures_pnl bucket)
        makeTxInsert({
          sourceType: 'futures_tx',
          canonicalType: 'futures_close_long',
          symbol: 'BTCUSDT',
          side: 'buy',
          amount: '500',
          eurPrice: '1',
          tradedAt: '2024-03-15T00:00:00.000Z',
          taxYear: 2024,
        }),
        // Earn: earn_interest (staking_earn bucket)
        makeTxInsert({
          sourceType: 'earn',
          canonicalType: 'earn_interest',
          symbol: 'ETH',
          side: null,
          amount: '0.1',
          price: '0',
          totalValue: '0',
          eurPrice: '3000',
          tradedAt: '2024-04-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);

    expect(result.errors).toHaveLength(0);

    const summaries = db.select().from(taxSummaries).all();
    const buckets = summaries.map((s) => s.bucket).sort();
    expect(buckets).toContain('private_sale');
    expect(buckets).toContain('futures_pnl');
    expect(buckets).toContain('staking_earn');

    // Verify they do not contaminate each other
    const privateSale = summaries.find((s) => s.bucket === 'private_sale');
    const futuresPnl = summaries.find((s) => s.bucket === 'futures_pnl');
    const stakingEarn = summaries.find((s) => s.bucket === 'staking_earn');

    expect(privateSale).toBeDefined();
    expect(futuresPnl).toBeDefined();
    expect(stakingEarn).toBeDefined();

    // Each bucket must have a distinct tradeCount or different net
    // Spot: 1 sell trade; Futures: 1 position; Earn: 1 income record
    expect(privateSale?.tradeCount).toBe(1);
    expect(futuresPnl?.tradeCount).toBe(1);
    expect(stakingEarn?.tradeCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: Idempotent re-run produces identical results
  // -------------------------------------------------------------------------
  it('running the engine twice produces identical results (stateless truncate+recompute)', () => {
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
          eurPrice: '60000',
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result1 = runTaxCalculation(db);
    const result2 = runTaxCalculation(db);

    // Both runs should produce the same number of lots, consumptions, summaries
    expect(result2.fifo.lots.length).toBe(result1.fifo.lots.length);
    expect(result2.fifo.consumptions.length).toBe(result1.fifo.consumptions.length);
    expect(result2.summaries.length).toBe(result1.summaries.length);

    // DB state after second run should match the first run's row counts
    const lots = db.select().from(fifoLots).all();
    expect(lots).toHaveLength(1); // not doubled

    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(1); // not doubled

    const summaries = db.select().from(taxSummaries).all();
    expect(summaries).toHaveLength(1); // not doubled

    // Same taxable amounts
    expect(result2.summaries[0].taxableAmountEur).toBe(result1.summaries[0].taxableAmountEur);
  });

  // -------------------------------------------------------------------------
  // Test 7: Cross-year lot continuity
  // -------------------------------------------------------------------------
  it('lot bought in 2024 can be consumed by a sell in 2025 (cross-year continuity)', () => {
    db.insert(transactions)
      .values([
        makeTxInsert({
          canonicalType: 'buy',
          symbol: 'BTC',
          amount: '1',
          eurPrice: '40000',
          tradedAt: '2024-01-15T00:00:00.000Z',
          taxYear: 2024,
        }),
        makeTxInsert({
          canonicalType: 'sell',
          symbol: 'BTC',
          side: 'sell',
          amount: '1',
          eurPrice: '55000',
          tradedAt: '2025-06-01T00:00:00.000Z',
          taxYear: 2025,
        }),
      ])
      .run();

    const result = runTaxCalculation(db);

    expect(result.errors).toHaveLength(0);

    // Lot created for 2024 buy
    const lots = db.select().from(fifoLots).all();
    expect(lots).toHaveLength(1);
    expect(lots[0].taxYear).toBe(2024);

    // Consumption should reference the 2024 lot and have taxYear=2025
    const consumptions = db.select().from(lotConsumptions).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].taxYear).toBe(2025);
    expect(consumptions[0].lotId).toBe(lots[0].id);

    // The lot was held ~502 days (Jan 15 2024 → Jun 1 2025) → haltefrist met!
    // Jan 15 2024 to Jun 1 2025 = 503 days → >= 366 → haltefristMet = true
    expect(consumptions[0].haltefristMet).toBe(true);

    // private_sale summary for 2025
    const summaries = db.select().from(taxSummaries).all();
    const summary2025 = summaries.find((s) => s.bucket === 'private_sale' && s.taxYear === 2025);
    expect(summary2025).toBeDefined();
    // Haltefrist met → taxable = 0
    expect(summary2025?.taxableAmountEur).toBe('0');
  });

  // -------------------------------------------------------------------------
  // Test 8: Earn 256 EUR Freigrenze cliff
  // -------------------------------------------------------------------------
  it('earn Freigrenze cliff: 255 EUR income → taxable=0, 257 EUR income → taxable=full amount', () => {
    // First: insert earn transactions totaling 255 EUR (below Freigrenze)
    db.insert(transactions)
      .values([
        makeTxInsert({
          sourceType: 'earn',
          canonicalType: 'earn_interest',
          symbol: 'ETH',
          side: null,
          amount: '0.085',
          price: '0',
          totalValue: '0',
          eurPrice: '3000',
          // 0.085 ETH × 3000 EUR = 255 EUR
          tradedAt: '2024-06-01T00:00:00.000Z',
          taxYear: 2024,
        }),
      ])
      .run();

    const result255 = runTaxCalculation(db);

    expect(result255.errors).toHaveLength(0);
    const summaries255 = db.select().from(taxSummaries).all();
    const earn255 = summaries255.find((s) => s.bucket === 'staking_earn' && s.taxYear === 2024);
    expect(earn255).toBeDefined();
    expect(earn255?.taxableAmountEur).toBe('0'); // Below Freigrenze

    // Now add one more earn transaction to push above 256 EUR
    db.insert(transactions)
      .values(
        makeTxInsert({
          sourceType: 'earn',
          canonicalType: 'earn_interest',
          symbol: 'ETH',
          side: null,
          amount: '0.000667',
          price: '0',
          totalValue: '0',
          eurPrice: '3000',
          // ~2 EUR more → total ~257 EUR (above 256 Freigrenze)
          tradedAt: '2024-07-01T00:00:00.000Z',
          taxYear: 2024,
        })
      )
      .run();

    const result257 = runTaxCalculation(db);

    expect(result257.errors).toHaveLength(0);
    const summaries257 = db.select().from(taxSummaries).all();
    const earn257 = summaries257.find((s) => s.bucket === 'staking_earn' && s.taxYear === 2024);
    expect(earn257).toBeDefined();
    // Above Freigrenze → full amount is taxable (cliff, not deduction)
    const taxableAmt = Number(earn257?.taxableAmountEur ?? '0');
    expect(taxableAmt).toBeGreaterThan(256);
    // The taxable amount should be the full total, not just the excess
    expect(taxableAmt).toBeCloseTo(Number(earn257?.totalGainsEur ?? '0'), 5);
  });
});
