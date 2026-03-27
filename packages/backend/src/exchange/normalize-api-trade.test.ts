import { describe, expect, it } from 'vitest';
import { normalizeApiTrade } from './normalize-api-trade.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCcxtTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fill-001',
    order: 'order-abc',
    timestamp: 1_700_000_000_000, // 2023-11-14T22:13:20.000Z
    datetime: '2023-11-14T22:13:20.000Z',
    symbol: 'BTC/USDT',
    side: 'buy',
    price: 37500.5,
    amount: 0.002,
    cost: 75.001,
    fee: {
      cost: 0.075,
      currency: 'USDT',
    },
    takerOrMaker: 'maker',
    type: 'limit',
    info: { fillId: 'fill-001', raw: 'raw-data' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeApiTrade', () => {
  // -------------------------------------------------------------------------
  // orderId — must use trade.id (fill ID), NOT trade.order
  // -------------------------------------------------------------------------

  it('uses trade.id as orderId (fill ID, not order ID)', () => {
    const trade = makeCcxtTrade({ id: 'fill-999', order: 'order-different' });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');

    expect(result.orderId).toBe('fill-999');
    expect(result.orderId).not.toBe('order-different');
  });

  it('sets orderId to null when trade.id is undefined', () => {
    const trade = makeCcxtTrade({ id: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');

    expect(result.orderId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // exchange + sourceType
  // -------------------------------------------------------------------------

  it('always sets exchange to "bitget"', () => {
    const result = normalizeApiTrade(
      makeCcxtTrade() as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    expect(result.exchange).toBe('bitget');
  });

  it('preserves spot_tx sourceType', () => {
    const result = normalizeApiTrade(
      makeCcxtTrade() as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    expect(result.sourceType).toBe('spot_tx');
  });

  it('preserves futures_tx sourceType', () => {
    const result = normalizeApiTrade(
      makeCcxtTrade() as Parameters<typeof normalizeApiTrade>[0],
      'futures_tx'
    );
    expect(result.sourceType).toBe('futures_tx');
  });

  // -------------------------------------------------------------------------
  // canonicalType from side
  // -------------------------------------------------------------------------

  it('maps side=buy to canonicalType=buy', () => {
    const trade = makeCcxtTrade({ side: 'buy' });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.canonicalType).toBe('buy');
    expect(result.side).toBe('buy');
  });

  it('maps side=sell to canonicalType=sell', () => {
    const trade = makeCcxtTrade({ side: 'sell' });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.canonicalType).toBe('sell');
    expect(result.side).toBe('sell');
  });

  it('maps unknown side to canonicalType=unknown and side=null', () => {
    const trade = makeCcxtTrade({ side: null });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.canonicalType).toBe('unknown');
    expect(result.side).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Numeric fields stored as strings
  // -------------------------------------------------------------------------

  it('stores price as string', () => {
    const trade = makeCcxtTrade({ price: 37500.5 });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.price).toBe('37500.5');
    expect(typeof result.price).toBe('string');
  });

  it('stores amount as string', () => {
    const trade = makeCcxtTrade({ amount: 0.002 });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.amount).toBe('0.002');
  });

  it('stores totalValue (cost) as string', () => {
    const trade = makeCcxtTrade({ cost: 75.001 });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.totalValue).toBe('75.001');
  });

  it('stores fee cost as string', () => {
    const trade = makeCcxtTrade({ fee: { cost: 0.075, currency: 'USDT' } });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.fee).toBe('0.075');
  });

  // -------------------------------------------------------------------------
  // Null/undefined defaults
  // -------------------------------------------------------------------------

  it('defaults price to "0" when undefined', () => {
    const trade = makeCcxtTrade({ price: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.price).toBe('0');
  });

  it('defaults amount to "0" when undefined', () => {
    const trade = makeCcxtTrade({ amount: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.amount).toBe('0');
  });

  it('defaults fee to "0" when fee is absent', () => {
    const trade = makeCcxtTrade({ fee: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.fee).toBe('0');
  });

  it('defaults fee to "0" when fee.cost is undefined', () => {
    const trade = makeCcxtTrade({ fee: { cost: undefined, currency: 'USDT' } });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.fee).toBe('0');
  });

  it('defaults totalValue to "0" when cost is undefined', () => {
    const trade = makeCcxtTrade({ cost: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.totalValue).toBe('0');
  });

  // -------------------------------------------------------------------------
  // tradedAt + taxYear
  // -------------------------------------------------------------------------

  it('converts timestamp to ISO string for tradedAt', () => {
    const trade = makeCcxtTrade({ timestamp: 1_700_000_000_000 });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.tradedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('extracts taxYear from tradedAt', () => {
    const trade = makeCcxtTrade({ timestamp: 1_700_000_000_000 }); // 2023
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.taxYear).toBe(2023);
  });

  it('extracts correct taxYear for different years', () => {
    const ts2022 = new Date('2022-06-15T10:00:00Z').getTime();
    const trade = makeCcxtTrade({ timestamp: ts2022 });
    const result = normalizeApiTrade(
      trade as Parameters<typeof normalizeApiTrade>[0],
      'futures_tx'
    );
    expect(result.taxYear).toBe(2022);
  });

  // -------------------------------------------------------------------------
  // sourceFile + rawRow
  // -------------------------------------------------------------------------

  it('sets sourceFile to null (no CSV file for API trades)', () => {
    const result = normalizeApiTrade(
      makeCcxtTrade() as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    expect(result.sourceFile).toBeNull();
  });

  it('stores trade.info as JSON in rawRow', () => {
    const trade = makeCcxtTrade({ info: { fillId: 'f001', extra: 'data' } });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.rawRow).toBe(JSON.stringify({ fillId: 'f001', extra: 'data' }));
  });

  it('stores empty object as rawRow when info is undefined', () => {
    const trade = makeCcxtTrade({ info: undefined });
    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(result.rawRow).toBe('{}');
  });

  // -------------------------------------------------------------------------
  // Checksum — deterministic dedup key
  // -------------------------------------------------------------------------

  it('produces a non-empty 64-char hex checksum', () => {
    const result = normalizeApiTrade(
      makeCcxtTrade() as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same trade + sourceType produces same checksum (deterministic)', () => {
    const trade = makeCcxtTrade();
    const r1 = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    const r2 = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    expect(r1.checksum).toBe(r2.checksum);
  });

  it('different trade.id produces different checksum', () => {
    const t1 = normalizeApiTrade(
      makeCcxtTrade({ id: 'fill-A' }) as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    const t2 = normalizeApiTrade(
      makeCcxtTrade({ id: 'fill-B' }) as Parameters<typeof normalizeApiTrade>[0],
      'spot_tx'
    );
    expect(t1.checksum).not.toBe(t2.checksum);
  });

  it('different sourceType produces different checksum for same trade.id', () => {
    const trade = makeCcxtTrade({ id: 'fill-001' });
    const spot = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');
    const futures = normalizeApiTrade(
      trade as Parameters<typeof normalizeApiTrade>[0],
      'futures_tx'
    );
    expect(spot.checksum).not.toBe(futures.checksum);
  });

  // -------------------------------------------------------------------------
  // Full spot trade normalization
  // -------------------------------------------------------------------------

  it('normalizes a complete spot buy trade correctly', () => {
    const trade = makeCcxtTrade({
      id: 'fill-spot-001',
      timestamp: new Date('2024-03-15T10:30:00Z').getTime(),
      symbol: 'ETH/USDT',
      side: 'buy',
      price: 3500,
      amount: 1.5,
      cost: 5250,
      fee: { cost: 5.25, currency: 'USDT' },
    });

    const result = normalizeApiTrade(trade as Parameters<typeof normalizeApiTrade>[0], 'spot_tx');

    expect(result).toMatchObject({
      orderId: 'fill-spot-001',
      exchange: 'bitget',
      sourceType: 'spot_tx',
      canonicalType: 'buy',
      symbol: 'ETH/USDT',
      side: 'buy',
      amount: '1.5',
      price: '3500',
      fee: '5.25',
      totalValue: '5250',
      taxYear: 2024,
      sourceFile: null,
    });
    expect(result.tradedAt).toBe('2024-03-15T10:30:00.000Z');
  });

  // -------------------------------------------------------------------------
  // Full futures trade normalization
  // -------------------------------------------------------------------------

  it('normalizes a complete futures sell trade correctly', () => {
    const trade = makeCcxtTrade({
      id: 'fill-fut-099',
      timestamp: new Date('2024-07-04T15:00:00Z').getTime(),
      symbol: 'BTC/USDT:USDT',
      side: 'sell',
      price: 62000,
      amount: 0.01,
      cost: 620,
      fee: { cost: 0.62, currency: 'USDT' },
    });

    const result = normalizeApiTrade(
      trade as Parameters<typeof normalizeApiTrade>[0],
      'futures_tx'
    );

    expect(result).toMatchObject({
      orderId: 'fill-fut-099',
      exchange: 'bitget',
      sourceType: 'futures_tx',
      canonicalType: 'sell',
      symbol: 'BTC/USDT:USDT',
      side: 'sell',
      amount: '0.01',
      price: '62000',
      taxYear: 2024,
    });
  });
});
