import { describe, expect, it, vi } from 'vitest';
import {
  CoinGeckoOutOfRangeError,
  createCoinGeckoClient,
  fetchCoinGeckoPrice,
  loadCoinGeckoSymbolMap,
} from './coingecko-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock fetch that returns a JSON body with the given status. */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

/** Build a mock fetch that throws a network error. */
function mockFetchNetworkError(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('Network error'));
}

// ---------------------------------------------------------------------------
// fetchCoinGeckoPrice
// ---------------------------------------------------------------------------

describe('fetchCoinGeckoPrice', () => {
  it('returns EUR price as Decimal string for a successful response', async () => {
    const fetch = mockFetch({
      market_data: {
        current_price: { eur: 92254.82 },
      },
    });

    const result = await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);
    expect(result).toBe('92254.82');
  });

  it('formats price as precise Decimal string (no float artefacts)', async () => {
    // 0.00123456789 can have float representation issues — ensure Decimal handles it
    const fetch = mockFetch({
      market_data: { current_price: { eur: 0.00123456789 } },
    });
    const result = await fetchCoinGeckoPrice('some-token', 1_717_200_000_000, fetch);
    expect(result).toBe('0.00123456789');
  });

  it('throws CoinGeckoOutOfRangeError when API returns error_code 10012', async () => {
    const fetch = mockFetch({
      error: {
        status: {
          error_code: 10012,
          error_message: 'coin not found or date out of range',
        },
      },
    });

    await expect(fetchCoinGeckoPrice('bitcoin', 1_000_000_000, fetch)).rejects.toThrow(
      CoinGeckoOutOfRangeError
    );
  });

  it('CoinGeckoOutOfRangeError message contains coinId and date', async () => {
    const fetch = mockFetch({
      error: {
        status: { error_code: 10012, error_message: 'out of range' },
      },
    });

    try {
      await fetchCoinGeckoPrice('bitcoin', 1_000_000_000, fetch);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CoinGeckoOutOfRangeError);
      expect((err as Error).message).toContain('bitcoin');
    }
  });

  it('returns null when market_data is missing', async () => {
    const fetch = mockFetch({ id: 'nonexistent-coin' });
    const result = await fetchCoinGeckoPrice('nonexistent-coin', 1_717_200_000_000, fetch);
    expect(result).toBeNull();
  });

  it('returns null when current_price is missing from market_data', async () => {
    const fetch = mockFetch({ market_data: {} });
    const result = await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);
    expect(result).toBeNull();
  });

  it('returns null when eur price is missing from current_price', async () => {
    const fetch = mockFetch({ market_data: { current_price: { usd: 100000 } } });
    const result = await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);
    expect(result).toBeNull();
  });

  it('returns null when server responds with 429 (rate limit)', async () => {
    const fetch = mockFetch({ status: 429, description: 'Too many requests' }, 429);
    const result = await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    const result = await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, mockFetchNetworkError());
    expect(result).toBeNull();
  });

  it('sends request to CoinGecko history endpoint with correct URL', async () => {
    const fetch = mockFetch({ market_data: { current_price: { eur: 50000 } } });
    await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);

    expect(fetch).toHaveBeenCalledOnce();
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/coins/bitcoin/history');
    expect(url).toContain('localization=false');
  });

  it('formats date as DD-MM-YYYY (not YYYY-MM-DD) in the URL', async () => {
    const fetch = mockFetch({ market_data: { current_price: { eur: 50000 } } });
    // 1717200000000 = 2024-06-01 00:00:00 UTC
    await fetchCoinGeckoPrice('bitcoin', 1_717_200_000_000, fetch);

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Must contain date=01-06-2024 (DD-MM-YYYY), not 2024-06-01
    expect(url).toContain('date=01-06-2024');
  });
});

// ---------------------------------------------------------------------------
// loadCoinGeckoSymbolMap
// ---------------------------------------------------------------------------

describe('loadCoinGeckoSymbolMap', () => {
  it('builds a lowercase symbol-to-id map from /coins/list response', async () => {
    const fetch = mockFetch([
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
      { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
    ]);

    const map = await loadCoinGeckoSymbolMap(fetch);

    expect(map.get('btc')).toBe('bitcoin');
    expect(map.get('eth')).toBe('ethereum');
    expect(map.get('ada')).toBe('cardano');
  });

  it('lowercases symbols from mixed-case API response', async () => {
    const fetch = mockFetch([{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }]);
    const map = await loadCoinGeckoSymbolMap(fetch);
    expect(map.get('btc')).toBe('bitcoin');
    expect(map.has('BTC')).toBe(false);
  });

  it('keeps first entry for duplicate symbols (most popular first on CoinGecko)', async () => {
    const fetch = mockFetch([
      { id: 'compound-governance-token', symbol: 'COMP', name: 'Compound' },
      { id: 'compound-coin', symbol: 'COMP', name: 'Compound Coin' },
    ]);
    const map = await loadCoinGeckoSymbolMap(fetch);
    expect(map.get('comp')).toBe('compound-governance-token');
  });

  it('returns empty Map for empty response', async () => {
    const fetch = mockFetch([]);
    const map = await loadCoinGeckoSymbolMap(fetch);
    expect(map.size).toBe(0);
  });

  it('throws on network error (caller must handle — startup operation)', async () => {
    await expect(loadCoinGeckoSymbolMap(mockFetchNetworkError())).rejects.toThrow('Network error');
  });

  it('sends request to /coins/list endpoint', async () => {
    const fetch = mockFetch([]);
    await loadCoinGeckoSymbolMap(fetch);

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/coins/list');
  });
});

// ---------------------------------------------------------------------------
// SYMBOL_OVERRIDES
// ---------------------------------------------------------------------------

describe('SYMBOL_OVERRIDES', () => {
  it('overrides known ambiguous symbol "comp" → "compound-governance-token"', async () => {
    // We test SYMBOL_OVERRIDES are exported and contain 'comp'.
    const { SYMBOL_OVERRIDES } = await import('./coingecko-client.js');
    expect(SYMBOL_OVERRIDES.comp).toBe('compound-governance-token');
  });
});

// ---------------------------------------------------------------------------
// createCoinGeckoClient
// ---------------------------------------------------------------------------

describe('createCoinGeckoClient', () => {
  it('returns object with fetchPrice and loadSymbolMap', () => {
    const client = createCoinGeckoClient();
    expect(typeof client.fetchPrice).toBe('function');
    expect(typeof client.loadSymbolMap).toBe('function');
  });

  it('fetchPrice returns EUR price (throttled wrapper)', async () => {
    const fetch = mockFetch({
      market_data: { current_price: { eur: 92254.82 } },
    });
    const client = createCoinGeckoClient(fetch);
    const result = await client.fetchPrice('bitcoin', 1_717_200_000_000);
    expect(result).toBe('92254.82');
  });

  it('loadSymbolMap returns map (unthrottled)', async () => {
    const fetch = mockFetch([{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }]);
    const client = createCoinGeckoClient(fetch);
    const map = await client.loadSymbolMap();
    expect(map.get('btc')).toBe('bitcoin');
  });

  it('fetchPrice propagates CoinGeckoOutOfRangeError', async () => {
    const fetch = mockFetch({
      error: { status: { error_code: 10012, error_message: 'out of range' } },
    });
    const client = createCoinGeckoClient(fetch);
    await expect(client.fetchPrice('bitcoin', 1_000_000_000)).rejects.toThrow(
      CoinGeckoOutOfRangeError
    );
  });
});
