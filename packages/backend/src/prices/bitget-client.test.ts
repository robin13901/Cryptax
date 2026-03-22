import { describe, expect, it, vi } from 'vitest';
import { createBitgetClient, fetchBitgetCandleClose } from './bitget-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Bitget candles response with the given candle rows. */
function buildCandleResponse(
  code: string,
  data: string[][]
): { code: string; msg: string; data: string[][] } {
  return { code, msg: '', data };
}

/** A single candle row: [openTimeMs, open, high, low, close, volume, quoteVolume] */
function makeCandle(openTimeMs: number, close: string): string[] {
  return [String(openTimeMs), '1.0', '1.1', '0.9', close, '100', '100'];
}

// ---------------------------------------------------------------------------
// fetchBitgetCandleClose tests
// ---------------------------------------------------------------------------

describe('fetchBitgetCandleClose', () => {
  it('returns close price string for a successful single-candle response', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [makeCandle(targetMs, '65432.10')]),
    });

    const result = await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    expect(result).toBe('65432.10');
  });

  it('returns null when API returns code 40034 (symbol not found)', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('40034', []),
    });

    const result = await fetchBitgetCandleClose('XXXXXXX', targetMs, '1min', mockFetch as never);

    expect(result).toBeNull();
  });

  it('returns null when API returns empty data array', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', []),
    });

    const result = await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    expect(result).toBeNull();
  });

  it('picks the candle closest to targetMs when multiple candles are returned', async () => {
    const targetMs = 1_711_900_620_000;
    const closeCandle = makeCandle(targetMs, 'CLOSE_PRICE');
    const farCandle = makeCandle(targetMs - 120_000, 'FAR_PRICE');
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [closeCandle, farCandle]),
    });

    const result = await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    expect(result).toBe('CLOSE_PRICE');
  });

  it('uses 5min granularity when specified', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [makeCandle(targetMs, '1234.56')]),
    });

    await fetchBitgetCandleClose('BTCEUR', targetMs, '5min', mockFetch as never);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('granularity=5min');
  });

  it('returns null and never throws when fetch throws a network error', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    expect(result).toBeNull();
  });

  it('constructs URL with endTime = targetMs + 60000 and limit = 5', async () => {
    const targetMs = 1_000_000_000_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [makeCandle(targetMs, '100')]),
    });

    await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`endTime=${targetMs + 60_000}`);
    expect(url).toContain('limit=5');
    expect(url).toContain('symbol=BTCEUR');
  });

  it('constructs URL pointing to api.bitget.com history-candles endpoint', async () => {
    const targetMs = 1_000_000_000_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [makeCandle(targetMs, '100')]),
    });

    await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('api.bitget.com');
    expect(url).toContain('/api/v2/spot/market/history-candles');
  });

  it('returns null for unknown error codes', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('99999', []),
    });

    const result = await fetchBitgetCandleClose('BTCEUR', targetMs, '1min', mockFetch as never);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createBitgetClient tests
// ---------------------------------------------------------------------------

describe('createBitgetClient', () => {
  it('returns an object with a fetchClose function', () => {
    const client = createBitgetClient();
    expect(typeof client.fetchClose).toBe('function');
  });

  it('fetchClose calls underlying fetch and returns close price', async () => {
    const targetMs = 1_711_900_620_000;
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => buildCandleResponse('00000', [makeCandle(targetMs, '50000.00')]),
    });

    const client = createBitgetClient(mockFetch as never);
    const result = await client.fetchClose('BTCEUR', targetMs, '1min');

    expect(result).toBe('50000.00');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('fetchClose is throttled (returns a promise)', () => {
    const client = createBitgetClient();
    const callResult = client.fetchClose('BTCEUR', 1_000_000_000_000, '1min');
    // Throttled function returns a promise
    expect(callResult).toBeInstanceOf(Promise);
    // Clean up the dangling promise
    callResult.catch(() => {});
  });
});
