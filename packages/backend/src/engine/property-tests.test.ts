/**
 * Property-Based Tests for FIFO Engine — Structural Invariants
 *
 * Uses fast-check to generate random buy/sell sequences and verify
 * that the FIFO engine maintains key structural invariants across
 * thousands of random inputs.
 *
 * Properties under test:
 *   1. lot.remainingAmount is never negative
 *   2. Total consumed per asset never exceeds total acquired
 *   3. Consumption cost basis consistency (costBasis = amountConsumed × lot.costPerUnitEur)
 *   4. FIFO ordering — oldest lots consumed first
 *
 * All properties run with numRuns=100 for reasonable CI performance.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runFifoEngine } from './fifo-engine.js';
import type { EngineTransaction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
/** Fixed symbol — property tests focus on intra-asset invariants. */
const SYMBOL = 'BTC';
/** Base date used for relative day offsets. */
const BASE_DATE = new Date('2022-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a date as ISO string with consistent UTC time. */
function toIsoString(date: Date): string {
  return date.toISOString();
}

/** Add N days to a date, returning a new Date. */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Build a sorted array of EngineTransaction objects from buy/sell specs.
 *
 * Buys are placed at days [0, 1, 2, ...] relative to BASE_DATE.
 * Sells are placed at days [buyCount, buyCount+1, ...] so they always
 * come chronologically after all buys — avoids the "no lots yet" edge case
 * that is already tested elsewhere.
 *
 * @param buys  Array of { amount, eurPrice } for each buy
 * @param sells Array of { amount, eurPrice } for each sell
 */
function buildTransactions(
  buys: ReadonlyArray<{ amount: number; eurPrice: number }>,
  sells: ReadonlyArray<{ amount: number; eurPrice: number }>
): EngineTransaction[] {
  let idCounter = 1;
  const txs: EngineTransaction[] = [];

  for (let i = 0; i < buys.length; i++) {
    const buy = buys[i];
    txs.push({
      id: idCounter++,
      orderId: null,
      exchange: 'test',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: SYMBOL,
      side: 'buy',
      amount: String(buy.amount),
      price: String(buy.eurPrice),
      fee: '0',
      totalValue: String(buy.amount * buy.eurPrice),
      tradedAt: toIsoString(addDays(BASE_DATE, i)),
      taxYear: 2024,
      eurPrice: String(buy.eurPrice),
    });
  }

  for (let i = 0; i < sells.length; i++) {
    const sell = sells[i];
    txs.push({
      id: idCounter++,
      orderId: null,
      exchange: 'test',
      sourceType: 'spot_tx',
      canonicalType: 'sell',
      symbol: SYMBOL,
      side: 'sell',
      amount: String(sell.amount),
      price: String(sell.eurPrice),
      fee: '0',
      totalValue: String(sell.amount * sell.eurPrice),
      tradedAt: toIsoString(addDays(BASE_DATE, buys.length + i)),
      taxYear: 2024,
      eurPrice: String(sell.eurPrice),
    });
  }

  return txs;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a single buy or sell: amount in (0, 10], eurPrice in [100, 100000].
 * Kept as small integers multiplied by 0.1 to avoid floating-point string issues.
 */
const tradeArb = fc.record({
  // amount: 0.1 to 10.0 in 0.1 steps
  amount: fc.integer({ min: 1, max: 100 }).map((n) => n * 0.1),
  // eurPrice: 100 to 100000 in 100 EUR steps
  eurPrice: fc.integer({ min: 1, max: 1000 }).map((n) => n * 100),
});

/**
 * Arbitrary for a list of 1–5 buys and 1–5 sells.
 */
const buySellListArb = fc.record({
  buys: fc.array(tradeArb, { minLength: 1, maxLength: 5 }),
  sells: fc.array(tradeArb, { minLength: 1, maxLength: 5 }),
});

// ---------------------------------------------------------------------------
// Property 1: lot.remainingAmount is never negative
// ---------------------------------------------------------------------------

describe('Property 1: lot.remainingAmount is never negative', () => {
  it('after any buy/sell sequence, all lot.remainingAmount values are >= 0', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        for (const lot of result.lots) {
          expect(lot.remainingAmount.isNegative()).toBe(false);
          expect(lot.remainingAmount.isFinite()).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('remaining amount never exceeds original amount', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        for (const lot of result.lots) {
          expect(lot.remainingAmount.lessThanOrEqualTo(lot.originalAmount)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Total consumed never exceeds total acquired per asset
// ---------------------------------------------------------------------------

describe('Property 2: Total consumed never exceeds total acquired per asset', () => {
  it('sum(amountConsumed) <= sum(originalAmount) per symbol', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        // Group lots by symbol (all BTC in this test)
        const symbolsInLots = new Set(result.lots.map((l) => l.symbol));

        for (const sym of symbolsInLots) {
          const totalAcquired = result.lots
            .filter((l) => l.symbol === sym)
            .reduce((sum, l) => sum.plus(l.originalAmount), result.lots[0].originalAmount.times(0));

          const totalConsumed = result.consumptions
            .filter((c) => {
              const lot = result.lots[c.lotIndex];
              return lot !== undefined && lot.symbol === sym;
            })
            .reduce(
              (sum, c) => sum.plus(c.amountConsumed),
              result.consumptions.length > 0
                ? result.consumptions[0].amountConsumed.times(0)
                : // If no consumptions, comparison trivially holds
                  totalAcquired.times(0)
            );

          expect(totalConsumed.lessThanOrEqualTo(totalAcquired)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('sum(lot.remainingAmount) + sum(amountConsumed) = sum(lot.originalAmount)', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        if (result.lots.length === 0) return;

        const zero = result.lots[0].originalAmount.times(0);

        const totalOriginal = result.lots.reduce((sum, l) => sum.plus(l.originalAmount), zero);
        const totalRemaining = result.lots.reduce((sum, l) => sum.plus(l.remainingAmount), zero);
        const totalConsumed = result.consumptions.reduce(
          (sum, c) => sum.plus(c.amountConsumed),
          zero
        );

        // original = remaining + consumed (accounting identity)
        const reconstructed = totalRemaining.plus(totalConsumed);
        expect(reconstructed.toFixed(10)).toBe(totalOriginal.toFixed(10));
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Consumption cost basis consistency
// ---------------------------------------------------------------------------
//
// For each ConsumptionRecord:
//   costBasisEur ≈ amountConsumed × lot.costPerUnitEur
// (fee=0 in test transactions so no allocation distortion)

describe('Property 3: Consumption cost basis consistency', () => {
  it('costBasisEur = amountConsumed × lot.costPerUnitEur for each consumption', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        for (const consumption of result.consumptions) {
          const lot = result.lots[consumption.lotIndex];
          expect(lot).toBeDefined();

          const expectedCostBasis = consumption.amountConsumed.times(lot.costPerUnitEur);

          // Allow tiny rounding tolerance (Decimal.js should be exact, but use epsilon for safety)
          const diff = consumption.costBasisEur.minus(expectedCostBasis).abs();
          expect(diff.lessThanOrEqualTo('0.000001')).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('gainLossEur = proceedsEur - costBasisEur - feeEur for each consumption', () => {
    fc.assert(
      fc.property(buySellListArb, ({ buys, sells }) => {
        const txs = buildTransactions(buys, sells);
        const result = runFifoEngine(txs);

        for (const consumption of result.consumptions) {
          const expectedGainLoss = consumption.proceedsEur
            .minus(consumption.costBasisEur)
            .minus(consumption.feeEur);

          const diff = consumption.gainLossEur.minus(expectedGainLoss).abs();
          expect(diff.lessThanOrEqualTo('0.000001')).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: FIFO ordering — oldest lots consumed first
// ---------------------------------------------------------------------------
//
// For a sequence of buys at strictly different timestamps and a sell:
// The lot consumed first must have been acquired earlier than lots consumed later.
// We test this via: for multiple consumptions from the same sell, the lotIndex
// corresponds to lots ordered by acquiredAt ASC (FIFO guarantee).

describe('Property 4: FIFO ordering — oldest lots consumed first', () => {
  it('consumptions from the same sell reference lots in non-decreasing acquiredAt order', () => {
    fc.assert(
      fc.property(
        fc.array(tradeArb, { minLength: 2, maxLength: 5 }),
        fc.record({
          // Sell amount = total buys to guarantee partial/full coverage
          eurPrice: fc.integer({ min: 100, max: 100000 }),
        }),
        (buys, sellSpec) => {
          // Sell total = sum of all buys (consume across all lots)
          const totalBuyAmount = buys.reduce((sum, b) => sum + b.amount, 0);
          const sells = [{ amount: totalBuyAmount, eurPrice: sellSpec.eurPrice }];

          const txs = buildTransactions(buys, sells);
          const result = runFifoEngine(txs);

          // Find the single sell transaction ID
          const sellTxIds = new Set(result.consumptions.map((c) => c.sellTransactionId));

          for (const sellTxId of sellTxIds) {
            const sellConsumptions = result.consumptions.filter(
              (c) => c.sellTransactionId === sellTxId
            );

            // Consumptions should be ordered by lot acquiredAt ASC (FIFO)
            for (let i = 1; i < sellConsumptions.length; i++) {
              const prevLot = result.lots[sellConsumptions[i - 1].lotIndex];
              const currLot = result.lots[sellConsumptions[i].lotIndex];
              expect(prevLot).toBeDefined();
              expect(currLot).toBeDefined();
              // Previous lot must have been acquired at or before current lot (FIFO order)
              expect(prevLot.acquiredAt <= currLot.acquiredAt).toBe(true);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('lots in the pool remain ordered by acquiredAt after partial sells', () => {
    fc.assert(
      fc.property(
        // 2-3 buys with distinct amounts, 1-2 partial sells (< total bought)
        fc.array(tradeArb, { minLength: 2, maxLength: 3 }),
        fc.array(
          fc.record({
            // Sell only 10-50% of the first buy amount to keep lots in pool
            sellFraction: fc.integer({ min: 1, max: 5 }).map((n) => n * 0.01),
            eurPrice: fc.integer({ min: 100, max: 100000 }),
          }),
          { minLength: 1, maxLength: 2 }
        ),
        (buys, sellSpecs) => {
          const firstBuyAmount = buys[0].amount;
          const sells = sellSpecs.map((s) => ({
            amount: Math.min(firstBuyAmount * s.sellFraction, firstBuyAmount * 0.5),
            eurPrice: s.eurPrice,
          }));

          const txs = buildTransactions(buys, sells);
          const result = runFifoEngine(txs);

          // Lots with remaining amount > 0 should still exist in acquiredAt order
          const remainingLots = result.lots.filter((l) => l.remainingAmount.greaterThan(0));
          for (let i = 1; i < remainingLots.length; i++) {
            const prev = remainingLots[i - 1];
            const curr = remainingLots[i];
            // acquiredAt is ISO string — lexicographic comparison is correct for UTC
            expect(prev.acquiredAt <= curr.acquiredAt).toBe(true);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Empty inputs produce empty outputs (edge case robustness)
// ---------------------------------------------------------------------------

describe('Property 5: Edge case robustness', () => {
  it('buys only (no sells) → no consumptions, all lots fully remaining', () => {
    fc.assert(
      fc.property(fc.array(tradeArb, { minLength: 1, maxLength: 5 }), (buys) => {
        const txs = buildTransactions(buys, []);
        const result = runFifoEngine(txs);

        expect(result.consumptions).toHaveLength(0);
        expect(result.sellsWithoutLots).toHaveLength(0);

        for (const lot of result.lots) {
          expect(lot.remainingAmount.equals(lot.originalAmount)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('sells only (no buys) → no lots, all sells land in sellsWithoutLots', () => {
    fc.assert(
      fc.property(fc.array(tradeArb, { minLength: 1, maxLength: 3 }), (sells) => {
        const txs = buildTransactions([], sells);
        const result = runFifoEngine(txs);

        expect(result.lots).toHaveLength(0);
        expect(result.consumptions).toHaveLength(0);
        expect(result.sellsWithoutLots).toHaveLength(sells.length);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('non-buy/sell canonical types are always skipped (never create lots or consumptions)', () => {
    const skippableTypes = [
      'transfer_in',
      'transfer_out',
      'earn_interest',
      'earn_deposit',
      'earn_withdrawal',
      'futures_close_long',
      'futures_close_short',
      'fee',
      'unknown',
    ] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...skippableTypes),
        fc.integer({ min: 1, max: 5 }).map((n) => n * 0.1),
        (canonicalType, amount) => {
          const tx: EngineTransaction = {
            id: 1,
            orderId: null,
            exchange: 'test',
            sourceType: 'spot_tx',
            canonicalType,
            symbol: SYMBOL,
            side: null,
            amount: String(amount),
            price: '0',
            fee: '0',
            totalValue: '0',
            tradedAt: '2024-01-01T00:00:00.000Z',
            taxYear: 2024,
            eurPrice: '100',
          };

          const result = runFifoEngine([tx]);

          expect(result.lots).toHaveLength(0);
          expect(result.consumptions).toHaveLength(0);
          expect(result.skipped).toHaveLength(1);
          expect(result.skipped[0].transactionId).toBe(1);
        }
      ),
      { numRuns: 50 }
    );
  });
});
