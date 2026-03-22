/**
 * Tests for the Futures P&L Engine.
 *
 * The futures P&L engine is strictly isolated from FIFO lot tracking.
 * It processes futures-specific canonical types and produces per-transaction
 * realized P&L records taxable under §20 EStG (Abgeltungssteuer).
 */
import { describe, expect, it } from 'vitest';
import { runFuturesPnlEngine } from './futures-pnl-engine.js';
import type { EngineTransaction } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeTx(overrides: Partial<EngineTransaction> = {}): EngineTransaction {
  idCounter += 1;
  return {
    id: idCounter,
    orderId: `ord-${idCounter}`,
    exchange: 'bitget',
    sourceType: 'futures_tx',
    canonicalType: 'futures_close_long',
    symbol: 'BTCUSDT',
    side: null,
    amount: '100',
    price: '0',
    fee: '0',
    totalValue: '0',
    tradedAt: '2024-06-15 10:00:00',
    taxYear: 2024,
    eurPrice: '1.08',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runFuturesPnlEngine', () => {
  it('records realized P&L for futures_close_long', () => {
    const tx = makeTx({
      canonicalType: 'futures_close_long',
      symbol: 'BTCUSDT',
      amount: '250',
      eurPrice: '0.92',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].transactionId).toBe(tx.id);
    expect(result.positions[0].symbol).toBe('BTC');
    // 250 * 0.92 = 230
    expect(result.positions[0].realizedPnlEur).toBe('230');
    expect(result.positions[0].feeEur).toBe('0');
    expect(result.positions[0].taxYear).toBe(2024);
    expect(result.skipped).toHaveLength(0);
  });

  it('records realized P&L for futures_close_short', () => {
    const tx = makeTx({
      canonicalType: 'futures_close_short',
      symbol: 'ETHUSDT',
      amount: '150',
      eurPrice: '0.91',
      taxYear: 2023,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].transactionId).toBe(tx.id);
    expect(result.positions[0].symbol).toBe('ETH');
    // 150 * 0.91 = 136.5
    expect(result.positions[0].realizedPnlEur).toBe('136.5');
    expect(result.positions[0].feeEur).toBe('0');
    expect(result.positions[0].taxYear).toBe(2023);
  });

  it('handles negative P&L (loss)', () => {
    const tx = makeTx({
      canonicalType: 'futures_close_long',
      symbol: 'BTCUSDT',
      amount: '-80',
      eurPrice: '0.93',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    // -80 * 0.93 = -74.4
    expect(result.positions[0].realizedPnlEur).toBe('-74.4');
  });

  it('records futures_fee as positive fee', () => {
    // Fees are stored as negative amounts in the source data
    const tx = makeTx({
      canonicalType: 'futures_fee',
      symbol: 'BTCUSDT',
      amount: '-2.5',
      eurPrice: '0.92',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].transactionId).toBe(tx.id);
    expect(result.positions[0].symbol).toBe('BTC');
    // abs(-2.5 * 0.92) = 2.3
    expect(result.positions[0].feeEur).toBe('2.3');
    expect(result.positions[0].realizedPnlEur).toBe('0');
  });

  it('records futures_funding as P&L (positive funding received)', () => {
    const tx = makeTx({
      canonicalType: 'futures_funding',
      symbol: 'BTCUSDT',
      amount: '5',
      eurPrice: '0.92',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    // 5 * 0.92 = 4.6
    expect(result.positions[0].realizedPnlEur).toBe('4.6');
    expect(result.positions[0].feeEur).toBe('0');
  });

  it('records futures_funding as P&L (negative funding paid)', () => {
    const tx = makeTx({
      canonicalType: 'futures_funding',
      symbol: 'ETHUSDT',
      amount: '-3',
      eurPrice: '0.91',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions).toHaveLength(1);
    // -3 * 0.91 = -2.73
    expect(result.positions[0].realizedPnlEur).toBe('-2.73');
    expect(result.positions[0].feeEur).toBe('0');
  });

  it('skips futures_open_long and futures_open_short', () => {
    const openLong = makeTx({ canonicalType: 'futures_open_long', symbol: 'BTCUSDT' });
    const openShort = makeTx({ canonicalType: 'futures_open_short', symbol: 'ETHUSDT' });

    const result = runFuturesPnlEngine([openLong, openShort]);

    expect(result.positions).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.transactionId)).toContain(openLong.id);
    expect(result.skipped.map((s) => s.transactionId)).toContain(openShort.id);
    expect(result.skipped[0].reason).toBe('not a futures transaction');
    expect(result.skipped[1].reason).toBe('not a futures transaction');
  });

  it('skips non-futures transactions', () => {
    const buy = makeTx({
      canonicalType: 'buy',
      sourceType: 'spot_tx',
      symbol: 'BTC',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      sourceType: 'spot_tx',
      symbol: 'ETH',
    });
    const earnInterest = makeTx({
      canonicalType: 'earn_interest',
      sourceType: 'earn',
      symbol: 'USDT',
    });

    const result = runFuturesPnlEngine([buy, sell, earnInterest]);

    expect(result.positions).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
    for (const s of result.skipped) {
      expect(s.reason).toBe('not a futures transaction');
    }
  });

  it('normalizes symbol from futures format (BTCUSDT → BTC)', () => {
    const tx = makeTx({
      canonicalType: 'futures_close_long',
      sourceType: 'futures_tx',
      symbol: 'BTCUSDT',
      amount: '100',
      eurPrice: '1',
    });

    const result = runFuturesPnlEngine([tx]);

    expect(result.positions[0].symbol).toBe('BTC');
  });

  it('processes multiple transactions across different symbols', () => {
    const btcClose = makeTx({
      canonicalType: 'futures_close_long',
      symbol: 'BTCUSDT',
      amount: '200',
      eurPrice: '0.92',
      taxYear: 2024,
    });
    const ethClose = makeTx({
      canonicalType: 'futures_close_short',
      symbol: 'ETHUSDT',
      amount: '50',
      eurPrice: '0.91',
      taxYear: 2024,
    });
    const btcFee = makeTx({
      canonicalType: 'futures_fee',
      symbol: 'BTCUSDT',
      amount: '-1',
      eurPrice: '0.92',
      taxYear: 2024,
    });

    const result = runFuturesPnlEngine([btcClose, ethClose, btcFee]);

    expect(result.positions).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);

    const btcPosition = result.positions.find((p) => p.transactionId === btcClose.id);
    const ethPosition = result.positions.find((p) => p.transactionId === ethClose.id);
    const feePosition = result.positions.find((p) => p.transactionId === btcFee.id);

    expect(btcPosition?.symbol).toBe('BTC');
    // 200 * 0.92 = 184
    expect(btcPosition?.realizedPnlEur).toBe('184');

    expect(ethPosition?.symbol).toBe('ETH');
    // 50 * 0.91 = 45.5
    expect(ethPosition?.realizedPnlEur).toBe('45.5');

    expect(feePosition?.symbol).toBe('BTC');
    // abs(-1 * 0.92) = 0.92
    expect(feePosition?.feeEur).toBe('0.92');
  });
});
