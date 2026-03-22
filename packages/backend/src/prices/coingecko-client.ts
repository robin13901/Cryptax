import { Decimal } from '@cryptax/shared';
import pThrottle from 'p-throttle';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Manual overrides for known ambiguous Bitget symbols where the CoinGecko
 * /coins/list "first entry" heuristic does not pick the canonical token.
 *
 * Keys are lowercase symbol strings. Values are CoinGecko coin IDs.
 */
export const SYMBOL_OVERRIDES: Record<string, string> = {
  comp: 'compound-governance-token',
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the CoinGecko API returns error_code 10012, indicating that the
 * requested date exceeds the 365-day free-tier history limit.
 *
 * Callers catching this error should set priceFailureReason = 'coingecko-miss'.
 */
export class CoinGeckoOutOfRangeError extends Error {
  constructor(coinId: string, dateStr: string) {
    super(`CoinGecko: date ${dateStr} is out of the 365-day free-tier range for coin "${coinId}"`);
    this.name = 'CoinGeckoOutOfRangeError';
  }
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

/**
 * Formats a UTC millisecond timestamp as DD-MM-YYYY, the format required by
 * the CoinGecko /coins/{id}/history endpoint.
 */
function formatCoinGeckoDate(utcMs: number): string {
  const d = new Date(utcMs);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Fetches the historical EUR price for a coin from the CoinGecko free API.
 *
 * @param coinId   - CoinGecko coin ID (e.g. "bitcoin", "ethereum")
 * @param utcMs    - UTC timestamp in milliseconds for the desired date
 * @param fetchFn  - Optional fetch implementation (defaults to globalThis.fetch)
 * @returns EUR price as a precise Decimal string, or null if unavailable
 * @throws CoinGeckoOutOfRangeError if the API returns error_code 10012
 */
export async function fetchCoinGeckoPrice(
  coinId: string,
  utcMs: number,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<string | null> {
  const dateStr = formatCoinGeckoDate(utcMs);
  const url = `${COINGECKO_BASE}/coins/${coinId}/history?date=${dateStr}&localization=false`;

  try {
    const response = await fetchFn(url);

    // Defensive: 429 rate limit — p-throttle should prevent this
    if (response.status === 429) {
      return null;
    }

    const body = await response.json();

    // Check for CoinGecko structured error (error_code 10012 = 365-day limit)
    if (body?.error?.status?.error_code === 10012) {
      throw new CoinGeckoOutOfRangeError(coinId, dateStr);
    }

    // Extract EUR price
    const eur: unknown = body?.market_data?.current_price?.eur;
    if (eur === undefined || eur === null) {
      return null;
    }

    // Convert to Decimal string to avoid float artefacts
    return new Decimal(eur as number).toString();
  } catch (err) {
    // Re-throw domain errors
    if (err instanceof CoinGeckoOutOfRangeError) {
      throw err;
    }
    // All other errors (network failures, JSON parse errors) → null
    return null;
  }
}

/**
 * Fetches the full CoinGecko coins list and builds a lowercase-symbol → coin-ID map.
 *
 * - Duplicate symbols: the first occurrence wins (CoinGecko lists the most popular
 *   coin first for each symbol).
 * - This function is intended to be called ONCE per enrichment run.
 *
 * @param fetchFn - Optional fetch implementation (defaults to globalThis.fetch)
 * @returns Map from lowercase symbol to CoinGecko coin ID
 * @throws on network or HTTP errors — caller must handle (this is a startup operation)
 */
export async function loadCoinGeckoSymbolMap(
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<Map<string, string>> {
  const url = `${COINGECKO_BASE}/coins/list`;
  const response = await fetchFn(url);
  const coins = (await response.json()) as Array<{
    id: string;
    symbol: string;
    name: string;
  }>;

  const map = new Map<string, string>();
  for (const coin of coins) {
    const symbol = coin.symbol.toLowerCase();
    // Keep the first entry for duplicate symbols
    if (!map.has(symbol)) {
      map.set(symbol, coin.id);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface CoinGeckoClient {
  /**
   * Throttled version of fetchCoinGeckoPrice (1 req / 2 s = 30 req/min).
   */
  fetchPrice: (coinId: string, utcMs: number) => Promise<string | null>;

  /**
   * Un-throttled loadCoinGeckoSymbolMap — intended for a single startup call.
   */
  loadSymbolMap: () => Promise<Map<string, string>>;
}

/**
 * Creates a CoinGecko client with rate limiting (1 request per 2 seconds).
 *
 * fetchPrice is wrapped with p-throttle to stay within the 30 req/min free
 * tier limit. loadSymbolMap is NOT throttled — it is a single startup call.
 *
 * @param fetchFn - Optional fetch implementation (injected for testing)
 */
export function createCoinGeckoClient(fetchFn?: typeof globalThis.fetch): CoinGeckoClient {
  const throttledFetch = pThrottle({ limit: 1, interval: 2000 })((coinId: string, utcMs: number) =>
    fetchCoinGeckoPrice(coinId, utcMs, fetchFn)
  );

  return {
    fetchPrice: throttledFetch,
    loadSymbolMap: () => loadCoinGeckoSymbolMap(fetchFn),
  };
}
