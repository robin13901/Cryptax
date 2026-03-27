import type { Trade } from 'ccxt';

// ---------------------------------------------------------------------------
// ExchangeAdapter
// ---------------------------------------------------------------------------

/**
 * Uniform interface for all exchange integrations.
 *
 * Each exchange ships a concrete class that implements this interface.
 * The sync engine depends only on the interface, keeping exchange-specific
 * code isolated in the adapter implementations.
 */
export interface ExchangeAdapter {
  /**
   * Fetch all spot trades. If `since` is provided, only returns trades
   * with a timestamp >= since (milliseconds epoch).
   */
  fetchSpotTrades(since?: number): Promise<Trade[]>;

  /**
   * Fetch all futures / swap trades. If `since` is provided, only returns
   * trades with a timestamp >= since (milliseconds epoch).
   */
  fetchFuturesTrades(since?: number): Promise<Trade[]>;

  /**
   * Test connectivity and credential validity. Returns true if the exchange
   * API accepts the credentials, false on authentication failure. Throws on
   * unexpected errors (network, misconfiguration).
   */
  testConnection(): Promise<boolean>;
}
