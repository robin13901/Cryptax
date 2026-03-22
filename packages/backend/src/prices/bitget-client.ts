import pThrottle from 'p-throttle';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BITGET_BASE_URL = 'https://api.bitget.com';
const CANDLE_ENDPOINT = '/api/v2/spot/market/history-candles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

export interface BitgetClient {
  fetchClose: (symbol: string, targetMs: number, granularity?: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Fetches the 1-minute (or specified granularity) candle from Bitget history-candles
 * endpoint whose open time is closest to `targetMs`, and returns the close price.
 *
 * Returns `null` when:
 *   - The pair doesn't exist (Bitget error code 40034)
 *   - The API returns an empty data array
 *   - Any network / JSON-parse error occurs
 *
 * Never throws.
 */
export async function fetchBitgetCandleClose(
  symbol: string,
  targetMs: number,
  granularity = '1min',
  fetchFn: FetchFn = globalThis.fetch
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      symbol,
      granularity,
      endTime: String(targetMs + 60_000),
      limit: '5',
    });

    const url = `${BITGET_BASE_URL}${CANDLE_ENDPOINT}?${params.toString()}`;
    const response = await fetchFn(url);
    const json = (await response.json()) as {
      code: string;
      msg: string;
      data: string[][];
    };

    // Pair not found
    if (json.code === '40034') {
      return null;
    }

    // Non-success or empty data
    if (json.code !== '00000' || !json.data || json.data.length === 0) {
      return null;
    }

    // Find candle whose openTime is closest to targetMs
    // Candle row format: [openTimeMs, open, high, low, close, volume, quoteVolume]
    let closest = json.data[0];
    let minDiff = Math.abs(Number(json.data[0][0]) - targetMs);

    for (let i = 1; i < json.data.length; i++) {
      const diff = Math.abs(Number(json.data[i][0]) - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = json.data[i];
      }
    }

    // Close price is index 4
    return closest[4];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Throttled client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Bitget client with fetch rate-limited to 10 requests/second.
 *
 * @param fetchFn - Optional fetch function override (for testing).
 */
export function createBitgetClient(fetchFn?: FetchFn): BitgetClient {
  const throttle = pThrottle({ limit: 20, interval: 1000 });

  const throttledFetch = throttle((symbol: string, targetMs: number, granularity: string) =>
    fetchBitgetCandleClose(symbol, targetMs, granularity, fetchFn)
  );

  return {
    fetchClose: (symbol: string, targetMs: number, granularity = '1min') =>
      throttledFetch(symbol, targetMs, granularity),
  };
}
