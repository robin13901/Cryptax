/**
 * FIFO Engine Core — comprehensive tests
 *
 * RED phase: all tests written before implementation.
 * GREEN phase: implemented runFifoEngine() to pass all cases.
 */
import { differenceInCalendarDays } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { runFifoEngine } from './fifo-engine.js';
import type { EngineTransaction } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idCounter = 1;

function makeTx(overrides: Partial<EngineTransaction> = {}): EngineTransaction {
  return {
    id: idCounter++,
    orderId: null,
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
    eurPrice: '50000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runFifoEngine', () => {
  it('creates a lot from a buy transaction', () => {
    const tx = makeTx({
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
    });

    const result = runFifoEngine([tx]);

    expect(result.lots).toHaveLength(1);
    const lot = result.lots[0];
    expect(lot.transactionId).toBe(tx.id);
    expect(lot.symbol).toBe('BTC');
    expect(lot.originalAmount.toFixed()).toBe('1');
    expect(lot.remainingAmount.toFixed()).toBe('1');
    // costPerUnitEur = (50000 * 1 + 0) / 1 = 50000
    expect(lot.costPerUnitEur.toFixed()).toBe('50000');
    expect(lot.acquiredAt).toBe(tx.tradedAt);
    expect(result.consumptions).toHaveLength(0);
    expect(result.sellsWithoutLots).toHaveLength(0);
  });

  it('consumes a lot on sell (full consumption)', () => {
    const buy = makeTx({
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy, sell]);

    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].remainingAmount.toFixed()).toBe('0');
    expect(result.consumptions).toHaveLength(1);
    const consumption = result.consumptions[0];
    expect(consumption.sellTransactionId).toBe(sell.id);
    expect(consumption.amountConsumed.toFixed()).toBe('1');
    // costBasis = 1 * 50000 = 50000
    expect(consumption.costBasisEur.toFixed()).toBe('50000');
    // proceeds = 1 * 60000 = 60000
    expect(consumption.proceedsEur.toFixed()).toBe('60000');
    // gainLoss = 60000 - 50000 - 0 = 10000
    expect(consumption.gainLossEur.toFixed()).toBe('10000');
    expect(result.sellsWithoutLots).toHaveLength(0);
  });

  it('consumes lots in FIFO order (oldest first)', () => {
    const buy1 = makeTx({
      canonicalType: 'buy',
      amount: '0.5',
      eurPrice: '40000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const buy2 = makeTx({
      canonicalType: 'buy',
      amount: '0.5',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-02-01T00:00:00.000Z',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '0.5',
      eurPrice: '55000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy1, buy2, sell]);

    expect(result.lots).toHaveLength(2);
    // First lot (FIFO — oldest, 40000 cost) should be fully consumed
    expect(result.lots[0].remainingAmount.toFixed()).toBe('0');
    // Second lot (60000 cost) should be untouched
    expect(result.lots[1].remainingAmount.toFixed()).toBe('0.5');

    expect(result.consumptions).toHaveLength(1);
    const consumption = result.consumptions[0];
    // Consumed from first lot at 40000 cost
    expect(consumption.costBasisEur.toFixed()).toBe('20000'); // 0.5 * 40000
    expect(consumption.proceedsEur.toFixed()).toBe('27500'); // 0.5 * 55000
    expect(consumption.lotIndex).toBe(0); // First lot
  });

  it('handles partial lot split across two lots', () => {
    const buy1 = makeTx({
      canonicalType: 'buy',
      amount: '0.3',
      eurPrice: '40000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const buy2 = makeTx({
      canonicalType: 'buy',
      amount: '0.7',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-02-01T00:00:00.000Z',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '0.5',
      eurPrice: '55000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy1, buy2, sell]);

    expect(result.lots).toHaveLength(2);
    // First lot fully consumed (0.3)
    expect(result.lots[0].remainingAmount.toFixed()).toBe('0');
    // Second lot partially consumed: 0.7 - 0.2 = 0.5 remaining
    expect(result.lots[1].remainingAmount.toFixed()).toBe('0.5');

    expect(result.consumptions).toHaveLength(2);
    // First consumption: full 0.3 from lot 0
    expect(result.consumptions[0].amountConsumed.toFixed()).toBe('0.3');
    expect(result.consumptions[0].lotIndex).toBe(0);
    // Second consumption: 0.2 from lot 1
    expect(result.consumptions[1].amountConsumed.toFixed()).toBe('0.2');
    expect(result.consumptions[1].lotIndex).toBe(1);
    expect(result.sellsWithoutLots).toHaveLength(0);
  });

  it('flags sell without matching lots', () => {
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      symbol: 'BTC',
      amount: '1',
      eurPrice: '60000',
    });

    const result = runFifoEngine([sell]);

    expect(result.lots).toHaveLength(0);
    expect(result.consumptions).toHaveLength(0);
    expect(result.sellsWithoutLots).toHaveLength(1);
    expect(result.sellsWithoutLots[0].transactionId).toBe(sell.id);
    expect(result.sellsWithoutLots[0].symbol).toBe('BTC');
    expect(result.sellsWithoutLots[0].amount).toBe('1');
  });

  it('flags sell that exceeds available lots', () => {
    const buy = makeTx({
      canonicalType: 'buy',
      amount: '0.5',
      eurPrice: '50000',
      fee: '0',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1.0',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy, sell]);

    // Partial consumption should occur
    expect(result.consumptions).toHaveLength(1);
    expect(result.consumptions[0].amountConsumed.toFixed()).toBe('0.5');

    // The sell is added to sellsWithoutLots because it couldn't be fully covered
    expect(result.sellsWithoutLots).toHaveLength(1);
    expect(result.sellsWithoutLots[0].transactionId).toBe(sell.id);
  });

  it('normalizes symbols from different source types', () => {
    // spot_tx buy with bare symbol "BTC"
    const buy = makeTx({
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: 'BTC',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    // spot_order sell with slash symbol "BTC/EUR"
    const sell = makeTx({
      sourceType: 'spot_order',
      canonicalType: 'sell',
      side: 'sell',
      symbol: 'BTC/EUR',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy, sell]);

    // They should match the same lot pool
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].remainingAmount.toFixed()).toBe('0');
    expect(result.consumptions).toHaveLength(1);
    expect(result.sellsWithoutLots).toHaveLength(0);
  });

  it('processes buys before sells at same timestamp', () => {
    const ts = '2024-06-01T12:00:00.000Z';
    // Both have same tradedAt — buy must be processed first
    const buy = makeTx({
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: ts,
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: ts,
    });

    // Pass sell before buy to test tiebreak ordering
    const result = runFifoEngine([sell, buy]);

    // Buy processed first → lot exists → sell can consume it
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].remainingAmount.toFixed()).toBe('0');
    expect(result.consumptions).toHaveLength(1);
    expect(result.sellsWithoutLots).toHaveLength(0);
  });

  it('computes correct cost basis with fees', () => {
    // spot_tx: fee is in coin units (base asset)
    // costPerUnitEur = (eurPrice * amount + fee * eurPrice) / amount
    //                = (50000 * 1 + 0.001 * 50000) / 1
    //                = (50000 + 50) / 1 = 50050
    const buy = makeTx({
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: 'BTC',
      amount: '1',
      eurPrice: '50000',
      fee: '0.001',
    });

    const result = runFifoEngine([buy]);

    expect(result.lots).toHaveLength(1);
    const lot = result.lots[0];
    // feeEur = 0.001 * 50000 = 50
    expect(lot.feeEur.toFixed()).toBe('50');
    // costPerUnitEur = (50000 + 50) / 1 = 50050
    expect(lot.costPerUnitEur.toFixed()).toBe('50050');
  });

  it('computes correct held days and Haltefrist (366 days = exempt)', () => {
    const buyDate = '2024-01-01T00:00:00.000Z';
    // 2025-01-02 is 366 days after 2024-01-01 (2024 is leap year: 366 days)
    const sellDate = '2025-01-02T00:00:00.000Z';

    const buy = makeTx({
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: buyDate,
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: sellDate,
    });

    const result = runFifoEngine([buy, sell]);

    expect(result.consumptions).toHaveLength(1);
    const expectedDays = differenceInCalendarDays(new Date(sellDate), new Date(buyDate));
    expect(result.consumptions[0].heldDays).toBe(expectedDays);
    expect(result.consumptions[0].haltefristMet).toBe(true);
  });

  it('computes correct held days and Haltefrist (365 days = not exempt)', () => {
    const buyDate = '2023-01-01T00:00:00.000Z';
    // 2024-01-01 is exactly 365 days after 2023-01-01 (2023 is not a leap year) — NOT exempt
    // With HALTEFRIST_DAYS=366, 365 < 366, so haltefristMet = false
    const sellDate = '2024-01-01T00:00:00.000Z';

    const buy = makeTx({
      canonicalType: 'buy',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: buyDate,
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: sellDate,
    });

    const result = runFifoEngine([buy, sell]);

    expect(result.consumptions).toHaveLength(1);
    const expectedDays = differenceInCalendarDays(new Date(sellDate), new Date(buyDate));
    expect(result.consumptions[0].heldDays).toBe(expectedDays);
    expect(result.consumptions[0].haltefristMet).toBe(false);
  });

  it('allocates sell fees proportionally across consumed lots', () => {
    // Buy 0.3 BTC and 0.7 BTC, sell all 1.0 BTC with 10 EUR fee
    const buy1 = makeTx({
      canonicalType: 'buy',
      amount: '0.3',
      eurPrice: '40000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const buy2 = makeTx({
      canonicalType: 'buy',
      amount: '0.7',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-02-01T00:00:00.000Z',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      amount: '1.0',
      eurPrice: '55000',
      fee: '10', // 10 EUR sell fee
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buy1, buy2, sell]);

    expect(result.consumptions).toHaveLength(2);
    // First consumption: 0.3 BTC → fee allocated = 0.3/1.0 * 10 = 3
    expect(result.consumptions[0].feeEur.toFixed()).toBe('3');
    // Second consumption: 0.7 BTC → fee allocated = 0.7/1.0 * 10 = 7
    expect(result.consumptions[1].feeEur.toFixed()).toBe('7');
    // Total allocated fees = 10
    const _totalFee = result.consumptions
      .reduce(
        (sum, c) => sum.plus(c.feeEur),
        result.consumptions[0].feeEur.minus(result.consumptions[0].feeEur)
      )
      .plus(
        result.consumptions.reduce(
          (sum, c) => sum.plus(c.feeEur),
          result.consumptions[0].feeEur.times(0)
        )
      );
    // Simpler check: sum them
    const fee0 = parseFloat(result.consumptions[0].feeEur.toFixed());
    const fee1 = parseFloat(result.consumptions[1].feeEur.toFixed());
    expect(fee0 + fee1).toBeCloseTo(10);
  });

  it('keeps separate lot pools per asset', () => {
    const buyBtc = makeTx({
      canonicalType: 'buy',
      symbol: 'BTC',
      amount: '1',
      eurPrice: '50000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const buyEth = makeTx({
      canonicalType: 'buy',
      symbol: 'ETH',
      amount: '10',
      eurPrice: '3000',
      fee: '0',
      tradedAt: '2024-01-01T00:00:00.000Z',
    });
    const sellBtc = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      symbol: 'BTC',
      amount: '1',
      eurPrice: '60000',
      fee: '0',
      tradedAt: '2024-06-01T00:00:00.000Z',
    });

    const result = runFifoEngine([buyBtc, buyEth, sellBtc]);

    expect(result.lots).toHaveLength(2);
    const btcLot = result.lots.find((l) => l.symbol === 'BTC');
    const ethLot = result.lots.find((l) => l.symbol === 'ETH');

    expect(btcLot?.remainingAmount.toFixed()).toBe('0'); // fully consumed
    expect(ethLot?.remainingAmount.toFixed()).toBe('10'); // untouched
    expect(result.consumptions).toHaveLength(1);
    expect(result.consumptions[0].sellTransactionId).toBe(sellBtc.id);
  });

  it('skips non-buy/sell transactions', () => {
    const futuresOpen = makeTx({
      canonicalType: 'futures_open_long',
      sourceType: 'futures_tx',
      symbol: 'BTCUSDT',
    });
    const transferIn = makeTx({
      canonicalType: 'transfer_in',
      sourceType: 'spot_tx',
      symbol: 'BTC',
    });

    const result = runFifoEngine([futuresOpen, transferIn]);

    expect(result.lots).toHaveLength(0);
    expect(result.consumptions).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    const skippedIds = result.skipped.map((s) => s.transactionId);
    expect(skippedIds).toContain(futuresOpen.id);
    expect(skippedIds).toContain(transferIn.id);
  });

  it('handles negative sell amounts from spot_tx CSV (signed amounts)', () => {
    // Bitget spot_tx CSVs store sell amounts as negative (e.g. "-233.32")
    const buy = makeTx({
      canonicalType: 'buy',
      sourceType: 'spot_tx',
      symbol: 'MOZ',
      amount: '1234.56',
      eurPrice: '0.04',
      fee: '0.05',
      tradedAt: '2024-12-10T11:15:00.000Z',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      side: 'sell',
      sourceType: 'spot_tx',
      symbol: 'MOZ',
      amount: '-233.32', // negative from CSV
      eurPrice: '0.04',
      fee: '-0.16', // negative fee from CSV
      tradedAt: '2024-12-10T14:36:00.000Z',
    });

    const result = runFifoEngine([buy, sell]);

    expect(result.consumptions).toHaveLength(1);
    const c = result.consumptions[0];
    expect(c.sellTransactionId).toBe(sell.id);
    expect(c.amountConsumed.toNumber()).toBeCloseTo(233.32, 6);
    // proceeds = 233.32 * 0.04 = 9.3328
    expect(c.proceedsEur.toNumber()).toBeCloseTo(9.3328, 4);
    expect(c.gainLossEur.isFinite()).toBe(true);
    expect(result.sellsWithoutLots).toHaveLength(0);
    // Lot should have remaining = 1234.56 - 233.32 = 1001.24
    expect(result.lots[0].remainingAmount.toNumber()).toBeCloseTo(1001.24, 6);
  });

  it('handles negative buy fee from spot_tx CSV', () => {
    // spot_tx CSVs may store fees as negative (e.g. "-0.05")
    const buy = makeTx({
      canonicalType: 'buy',
      sourceType: 'spot_tx',
      symbol: 'MOZ',
      amount: '1000',
      eurPrice: '0.04',
      fee: '-0.05', // negative fee from CSV
    });

    const result = runFifoEngine([buy]);

    expect(result.lots).toHaveLength(1);
    const lot = result.lots[0];
    // feeEur = abs(-0.05) * 0.04 = 0.002
    expect(lot.feeEur.toNumber()).toBeCloseTo(0.002, 6);
    // costPerUnitEur = (0.04 * 1000 + 0.002) / 1000 = 0.040002
    expect(lot.costPerUnitEur.toNumber()).toBeCloseTo(0.040002, 6);
  });

  it('does not mutate the input transaction array', () => {
    const txs = [
      makeTx({ canonicalType: 'buy', tradedAt: '2024-02-01T00:00:00.000Z' }),
      makeTx({ canonicalType: 'buy', tradedAt: '2024-01-01T00:00:00.000Z' }),
    ];
    const originalOrder = txs.map((t) => t.id);

    runFifoEngine(txs);

    // Input array must remain in original order
    expect(txs.map((t) => t.id)).toEqual(originalOrder);
  });

  it('assigns sequential lot indices starting at 0', () => {
    const buy1 = makeTx({ canonicalType: 'buy', tradedAt: '2024-01-01T00:00:00.000Z' });
    const buy2 = makeTx({ canonicalType: 'buy', tradedAt: '2024-02-01T00:00:00.000Z' });

    const result = runFifoEngine([buy1, buy2]);

    expect(result.lots[0].id).toBe(0);
    expect(result.lots[1].id).toBe(1);
  });
});
