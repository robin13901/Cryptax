import { describe, expect, it, vi } from 'vitest';
import type { ResolutionDeps, TransactionRow } from './resolution-strategy.js';
import { resolvePrice } from './resolution-strategy.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TARGET_MS = 1_711_875_780_000; // 2024-03-31 10:23:00 UTC (Berlin spring, CEST)
// Minute-precision bucket for the above timestamp
const TIMESTAMP_MINUTE = new Date(Math.floor(TARGET_MS / 60_000) * 60_000).toISOString();

/** A spot_order with EUR pair — should use CSV fill-price. */
function makeSpotOrderEur(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    sourceType: 'spot_order',
    symbol: 'BTC/EUR',
    price: '65432.10',
    tradedAt: '2024-03-31 12:23:00', // Berlin CEST (+2) → 10:23 UTC
    ...overrides,
  };
}

/** A spot_tx row — needs API resolution. */
function makeSpotTx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 2,
    sourceType: 'spot_tx',
    symbol: 'BTC',
    price: '0',
    tradedAt: '2024-03-31 12:23:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ResolutionDeps> = {}): ResolutionDeps {
  return {
    bitgetClient: {
      fetchClose: vi.fn().mockResolvedValue(null),
    },
    coingeckoClient: {
      fetchPrice: vi.fn().mockResolvedValue(null),
    },
    symbolMap: new Map([['btc', 'bitcoin']]),
    cache: {
      lookup: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    db: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Step 1: CSV fill-price shortcut
// ---------------------------------------------------------------------------

describe('resolvePrice - CSV fill-price shortcut', () => {
  it('returns csv-fill source immediately for spot_order with EUR pair and non-zero price', async () => {
    const deps = makeDeps();
    const tx = makeSpotOrderEur();

    const outcome = await resolvePrice(tx, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('csv-fill');
    expect(outcome.result.eurPrice).toBe('65432.10');

    // No API calls made
    expect(deps.bitgetClient.fetchClose).not.toHaveBeenCalled();
    expect(deps.coingeckoClient.fetchPrice).not.toHaveBeenCalled();
    expect(deps.cache.lookup).not.toHaveBeenCalled();
  });

  it('does NOT use csv-fill for spot_order with EUR pair when price is "0"', async () => {
    const deps = makeDeps();
    const tx = makeSpotOrderEur({ price: '0' });

    const _outcome = await resolvePrice(tx, deps);

    // Falls through to cache lookup (not csv-fill)
    expect(deps.cache.lookup).toHaveBeenCalled();
  });

  it('does NOT use csv-fill for spot_tx even with non-zero price', async () => {
    const deps = makeDeps();
    const tx = makeSpotTx({ price: '50000' });

    await resolvePrice(tx, deps);

    expect(deps.cache.lookup).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 2: Cache hit
// ---------------------------------------------------------------------------

describe('resolvePrice - cache hit', () => {
  it('returns cached result without calling any API client', async () => {
    const cachedEntry = {
      id: 1,
      symbol: 'BTCEUR',
      timestamp: TIMESTAMP_MINUTE,
      eurPrice: '65000.00',
      source: 'bitget-direct',
      usdtPrice: null,
      usdtEurRate: null,
      fetchedAt: new Date().toISOString(),
    };

    const deps = makeDeps({
      cache: {
        lookup: vi.fn().mockResolvedValue(cachedEntry),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const tx = makeSpotTx();

    const outcome = await resolvePrice(tx, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.eurPrice).toBe('65000.00');
    expect(outcome.result.source).toBe('bitget-direct');

    expect(deps.bitgetClient.fetchClose).not.toHaveBeenCalled();
    expect(deps.coingeckoClient.fetchPrice).not.toHaveBeenCalled();
  });

  it('passes usdtPrice and usdtEurRate from cache entry', async () => {
    const cachedEntry = {
      id: 2,
      symbol: 'BTCEUR',
      timestamp: TIMESTAMP_MINUTE,
      eurPrice: '64000.00',
      source: 'bitget-usdt',
      usdtPrice: '69000.00',
      usdtEurRate: '0.9275',
      fetchedAt: new Date().toISOString(),
    };

    const deps = makeDeps({
      cache: {
        lookup: vi.fn().mockResolvedValue(cachedEntry),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usdtPrice).toBe('69000.00');
    expect(outcome.result.usdtEurRate).toBe('0.9275');
  });
});

// ---------------------------------------------------------------------------
// Step 3: Bitget direct EUR
// ---------------------------------------------------------------------------

describe('resolvePrice - Bitget direct EUR', () => {
  it('returns bitget-direct on 1-minute hit', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR' && gran === '1min') return Promise.resolve('65432.10');
          return Promise.resolve(null);
        }),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('bitget-direct');
    expect(outcome.result.eurPrice).toBe('65432.10');
  });

  it('falls back to 5-minute when 1-minute returns null, then returns bitget-direct', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR' && gran === '5min') return Promise.resolve('65000.00');
          return Promise.resolve(null);
        }),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('bitget-direct');
    expect(outcome.result.eurPrice).toBe('65000.00');
  });

  it('writes to cache after successful Bitget direct resolution', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR' && gran === '1min') return Promise.resolve('65432.10');
          return Promise.resolve(null);
        }),
      },
      cache: {
        lookup: vi.fn().mockResolvedValue(null),
        upsert,
      },
    });

    await resolvePrice(makeSpotTx(), deps);

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][1]).toMatchObject({
      symbol: 'BTCEUR',
      eurPrice: '65432.10',
      source: 'bitget-direct',
    });
  });
});

// ---------------------------------------------------------------------------
// Step 4: Bitget USDT fallback
// ---------------------------------------------------------------------------

describe('resolvePrice - Bitget USDT fallback', () => {
  it('returns bitget-usdt when both COIN/USDT and USDT/EUR succeed at 1min', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR') return Promise.resolve(null);
          if (symbol === 'BTCUSDT' && gran === '1min') return Promise.resolve('70000.00');
          if (symbol === 'USDTEUR' && gran === '1min') return Promise.resolve('0.93');
          return Promise.resolve(null);
        }),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('bitget-usdt');
    // 70000 * 0.93 = 65100
    expect(outcome.result.eurPrice).toBe('65100');
    expect(outcome.result.usdtPrice).toBe('70000.00');
    expect(outcome.result.usdtEurRate).toBe('0.93');
  });

  it('multiplies COIN/USDT by USDT/EUR using Decimal.js precision', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR') return Promise.resolve(null);
          if (symbol === 'BTCUSDT' && gran === '1min') return Promise.resolve('0.123456789');
          if (symbol === 'USDTEUR' && gran === '1min') return Promise.resolve('0.987654321');
          return Promise.resolve(null);
        }),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Verify Decimal precision — 0.123456789 * 0.987654321 = 0.121932631112635269
    const expected = '0.121932631112635269';
    expect(outcome.result.eurPrice).toBe(expected);
  });

  it('falls through to 5min USDT when 1min legs return null', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR') return Promise.resolve(null);
          if (symbol === 'BTCUSDT' && gran === '5min') return Promise.resolve('70000.00');
          if (symbol === 'USDTEUR' && gran === '5min') return Promise.resolve('0.93');
          return Promise.resolve(null);
        }),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('bitget-usdt');
  });

  it('falls through to CoinGecko when USDT leg returns null at both granularities', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string) => {
          // BTCEUR always null; BTCUSDT null; USDTEUR has data
          if (symbol === 'USDTEUR') return Promise.resolve('0.93');
          return Promise.resolve(null);
        }),
      },
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('coingecko');
  });

  it('falls through to CoinGecko when COIN/USDT leg returns null', async () => {
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string) => {
          // USDTEUR null; BTCUSDT has data
          if (symbol === 'BTCUSDT') return Promise.resolve('70000');
          return Promise.resolve(null);
        }),
      },
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('coingecko');
  });

  it('writes to cache with usdtPrice and usdtEurRate after USDT fallback success', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      bitgetClient: {
        fetchClose: vi.fn().mockImplementation((symbol: string, _ms: number, gran: string) => {
          if (symbol === 'BTCEUR') return Promise.resolve(null);
          if (symbol === 'BTCUSDT' && gran === '1min') return Promise.resolve('70000.00');
          if (symbol === 'USDTEUR' && gran === '1min') return Promise.resolve('0.93');
          return Promise.resolve(null);
        }),
      },
      cache: {
        lookup: vi.fn().mockResolvedValue(null),
        upsert,
      },
    });

    await resolvePrice(makeSpotTx(), deps);

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][1]).toMatchObject({
      source: 'bitget-usdt',
      usdtPrice: '70000.00',
      usdtEurRate: '0.93',
    });
  });
});

// ---------------------------------------------------------------------------
// Step 5: CoinGecko fallback
// ---------------------------------------------------------------------------

describe('resolvePrice - CoinGecko fallback', () => {
  it('returns coingecko when CoinGecko has the price', async () => {
    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.source).toBe('coingecko');
    expect(outcome.result.eurPrice).toBe('65000.00');
  });

  it('returns coingecko-miss when CoinGeckoOutOfRangeError is thrown', async () => {
    const { CoinGeckoOutOfRangeError: Err } = await import('./coingecko-client.js');
    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockRejectedValue(new Err('bitcoin', '01-01-2020')),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toBe('coingecko-miss');
  });

  it('returns coingecko-miss when CoinGecko returns null', async () => {
    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue(null),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toBe('coingecko-miss');
  });

  it('writes to cache after successful CoinGecko resolution', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue('65000.00'),
      },
      cache: {
        lookup: vi.fn().mockResolvedValue(null),
        upsert,
      },
    });

    await resolvePrice(makeSpotTx(), deps);

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][1]).toMatchObject({
      symbol: 'BTCEUR',
      eurPrice: '65000.00',
      source: 'coingecko',
    });
  });

  it('returns no-bitget-pair when symbol not found in symbolMap (CoinGecko not tried)', async () => {
    const deps = makeDeps({
      symbolMap: new Map(), // BTC not in map
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toBe('no-bitget-pair');
    expect(deps.coingeckoClient.fetchPrice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 6: All sources fail
// ---------------------------------------------------------------------------

describe('resolvePrice - all sources fail', () => {
  it('returns no-bitget-pair when all sources return null and no symbolMap entry', async () => {
    const deps = makeDeps({
      symbolMap: new Map(),
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toBe('no-bitget-pair');
  });

  it('returns coingecko-miss when all Bitget sources fail and CoinGecko returns null', async () => {
    const deps = makeDeps({
      // bitgetClient already returns null for all calls (default in makeDeps)
      coingeckoClient: {
        fetchPrice: vi.fn().mockResolvedValue(null),
      },
    });

    const outcome = await resolvePrice(makeSpotTx(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toBe('coingecko-miss');
  });
});
