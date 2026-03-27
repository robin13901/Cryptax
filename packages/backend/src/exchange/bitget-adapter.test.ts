import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitgetAdapter } from './bitget-adapter.js';

// ---------------------------------------------------------------------------
// Mock ccxt module
// ---------------------------------------------------------------------------

const mockFetchMyTrades = vi.fn();
const mockFetchBalance = vi.fn();

vi.mock('ccxt', () => {
  return {
    bitget: vi.fn().mockImplementation(() => ({
      fetchMyTrades: mockFetchMyTrades,
      fetchBalance: mockFetchBalance,
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<{ id: string; timestamp: number; symbol: string }> = {}) {
  return {
    id: overrides.id ?? 'trade-1',
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    symbol: overrides.symbol ?? 'BTC/USDT',
    side: 'buy',
    price: 30000,
    amount: 0.1,
    cost: 3000,
    fee: { cost: 3, currency: 'USDT' },
    order: 'order-1',
    type: 'limit',
    takerOrMaker: 'maker',
    info: {},
  };
}

const CREDENTIALS = { apiKey: 'key', secret: 'secret', password: 'pass' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BitgetAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // fetchSpotTrades
  // -------------------------------------------------------------------------

  describe('fetchSpotTrades', () => {
    it('calls fetchMyTrades with symbol=undefined and empty params', async () => {
      mockFetchMyTrades.mockResolvedValueOnce([]);

      const adapter = new BitgetAdapter(CREDENTIALS);
      await adapter.fetchSpotTrades();

      expect(mockFetchMyTrades).toHaveBeenCalledWith(
        undefined, // symbol
        undefined, // since (cursor)
        100, // limit
        {} // params — empty for spot
      );
    });

    it('passes since as initial cursor', async () => {
      mockFetchMyTrades.mockResolvedValueOnce([]);

      const adapter = new BitgetAdapter(CREDENTIALS);
      await adapter.fetchSpotTrades(1_700_000_000_000);

      expect(mockFetchMyTrades).toHaveBeenCalledWith(undefined, 1_700_000_000_000, 100, {});
    });
  });

  // -------------------------------------------------------------------------
  // fetchFuturesTrades
  // -------------------------------------------------------------------------

  describe('fetchFuturesTrades', () => {
    it('calls fetchMyTrades with params containing type: swap', async () => {
      mockFetchMyTrades.mockResolvedValueOnce([]);

      const adapter = new BitgetAdapter(CREDENTIALS);
      await adapter.fetchFuturesTrades();

      expect(mockFetchMyTrades).toHaveBeenCalledWith(undefined, undefined, 100, { type: 'swap' });
    });

    it('passes since as initial cursor for futures', async () => {
      mockFetchMyTrades.mockResolvedValueOnce([]);

      const adapter = new BitgetAdapter(CREDENTIALS);
      await adapter.fetchFuturesTrades(1_710_000_000_000);

      expect(mockFetchMyTrades).toHaveBeenCalledWith(undefined, 1_710_000_000_000, 100, {
        type: 'swap',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  describe('pagination', () => {
    it('stops when batch is empty', async () => {
      mockFetchMyTrades.mockResolvedValueOnce([]);

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.fetchSpotTrades();

      expect(mockFetchMyTrades).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(0);
    });

    it('stops when batch.length < limit (last page)', async () => {
      // First page: 100 trades (full), second page: 50 trades (last page)
      const page1 = Array.from({ length: 100 }, (_, i) =>
        makeTrade({ id: `t${i}`, timestamp: 1_700_000_000_000 + i * 1000 })
      );
      const page2 = Array.from({ length: 50 }, (_, i) =>
        makeTrade({ id: `t${100 + i}`, timestamp: 1_700_000_100_000 + i * 1000 })
      );

      mockFetchMyTrades.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.fetchSpotTrades();

      expect(mockFetchMyTrades).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(150);
    });

    it('stops when timestamp does not advance (stuck cursor guard)', async () => {
      // Both pages return trades with the same last timestamp — triggers stuck guard
      const stuckTs = 1_700_000_000_000;
      const page1 = Array.from({ length: 100 }, (_, i) =>
        makeTrade({ id: `t${i}`, timestamp: stuckTs })
      );

      mockFetchMyTrades.mockResolvedValueOnce(page1);

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.fetchSpotTrades(stuckTs);

      // Cursor = stuckTs on first call, lastTs = stuckTs → stuck → break
      expect(mockFetchMyTrades).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(100);
    });

    it('accumulates trades across multiple full pages', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) =>
        makeTrade({ id: `p1-${i}`, timestamp: 1_700_000_000_000 + i * 1000 })
      );
      const page2 = Array.from({ length: 100 }, (_, i) =>
        makeTrade({ id: `p2-${i}`, timestamp: 1_700_000_100_000 + i * 1000 })
      );
      const page3 = Array.from({ length: 30 }, (_, i) =>
        makeTrade({ id: `p3-${i}`, timestamp: 1_700_000_200_000 + i * 1000 })
      );

      mockFetchMyTrades
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce(page3);

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.fetchSpotTrades();

      expect(mockFetchMyTrades).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(230);
    });

    it('advances cursor by +1 from the last timestamp on each page', async () => {
      const lastTsPage1 = 1_700_000_099_000;
      const page1 = Array.from({ length: 100 }, (_, i) =>
        makeTrade({ id: `t${i}`, timestamp: 1_700_000_000_000 + i * 1000 })
      );
      // Confirm last trade timestamp
      page1[99].timestamp = lastTsPage1;

      mockFetchMyTrades.mockResolvedValueOnce(page1).mockResolvedValueOnce([]); // empty second page to stop

      const adapter = new BitgetAdapter(CREDENTIALS);
      await adapter.fetchSpotTrades();

      // Second call must use cursor = lastTsPage1 + 1
      expect(mockFetchMyTrades).toHaveBeenNthCalledWith(2, undefined, lastTsPage1 + 1, 100, {});
    });
  });

  // -------------------------------------------------------------------------
  // testConnection
  // -------------------------------------------------------------------------

  describe('testConnection', () => {
    it('returns true when fetchBalance succeeds', async () => {
      mockFetchBalance.mockResolvedValueOnce({ total: { BTC: 0.5 } });

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockFetchBalance).toHaveBeenCalledTimes(1);
    });

    it('returns false when fetchBalance throws (auth error)', async () => {
      mockFetchBalance.mockRejectedValueOnce(new Error('AuthenticationError'));

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      mockFetchBalance.mockRejectedValueOnce(new Error('NetworkError: request failed'));

      const adapter = new BitgetAdapter(CREDENTIALS);
      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });
});
