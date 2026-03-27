import type { Trade } from 'ccxt';
import { bitget as BitgetExchange } from 'ccxt';
import type { ExchangeAdapter } from './exchange-adapter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BitgetCredentials {
  apiKey: string;
  secret: string;
  password: string;
}

// ---------------------------------------------------------------------------
// BitgetAdapter
// ---------------------------------------------------------------------------

/**
 * ccxt-backed Bitget exchange adapter.
 *
 * Implements the ExchangeAdapter interface for spot and futures trade fetching
 * with automatic pagination using the since+1 cursor pattern.
 *
 * Bitget requires three credentials:
 * - apiKey:   API key from Bitget dashboard
 * - secret:   API secret
 * - password: API passphrase (NOT the app login password)
 */
export class BitgetAdapter implements ExchangeAdapter {
  private readonly exchange: InstanceType<typeof BitgetExchange>;

  constructor(credentials: BitgetCredentials) {
    this.exchange = new BitgetExchange({
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      password: credentials.password,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fetch all spot trades since a given timestamp.
   * Calls fetchMyTrades with default params (routes to v2/spot/trade/fills).
   */
  async fetchSpotTrades(since?: number): Promise<Trade[]> {
    return this.fetchAllTrades(undefined, since, {});
  }

  /**
   * Fetch all futures/swap trades since a given timestamp.
   * Calls fetchMyTrades with { type: 'swap' } (routes to v2/mix/order/fills).
   */
  async fetchFuturesTrades(since?: number): Promise<Trade[]> {
    return this.fetchAllTrades(undefined, since, { type: 'swap' });
  }

  /**
   * Test connectivity by calling fetchBalance.
   * Returns true if credentials are valid, false on authentication failure.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.exchange.fetchBalance();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  /**
   * Paginate through all trades using the since+1 cursor pattern.
   *
   * Break conditions:
   * 1. Empty batch (no more data)
   * 2. batch.length < limit (last page — fewer records than requested)
   * 3. lastTs === cursor (no progress — avoids infinite loop on stuck timestamp)
   *
   * Cursor advancement: cursor = lastTs + 1 to avoid re-fetching the last trade.
   */
  private async fetchAllTrades(
    symbol: string | undefined,
    since: number | undefined,
    params: Record<string, unknown>
  ): Promise<Trade[]> {
    const all: Trade[] = [];
    let cursor: number | undefined = since;
    const limit = 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await this.exchange.fetchMyTrades(symbol, cursor, limit, params);

      if (batch.length === 0) {
        break;
      }

      all.push(...batch);

      const lastTs = batch[batch.length - 1].timestamp;

      // Guard: no progress (timestamp did not advance)
      if (lastTs === undefined || lastTs === cursor) {
        break;
      }

      // Advance past the last trade to avoid re-fetching it
      cursor = lastTs + 1;

      // Last page indicator: fewer records than the requested limit
      if (batch.length < limit) {
        break;
      }
    }

    return all;
  }
}
