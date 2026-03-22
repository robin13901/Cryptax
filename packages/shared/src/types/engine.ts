// ---------------------------------------------------------------------------
// Engine API response types
// ---------------------------------------------------------------------------

/**
 * Response from POST /api/engine/run.
 *
 * Contains tax summaries, per-engine counts, any null price errors (422 case),
 * and general errors encountered during calculation.
 */
export interface EngineRunResponse {
  success: boolean;
  summaries: Array<{
    taxYear: number;
    bucket: string;
    totalGainsEur: string;
    totalLossesEur: string;
    netEur: string;
    taxableAmountEur: string;
    estimatedTaxEur: string;
    tradeCount: number;
  }>;
  fifo: {
    lotsCreated: number;
    consumptions: number;
    sellsWithoutLots: number;
  };
  futures: {
    positionsRecorded: number;
  };
  earn: {
    incomeRecorded: number;
    lotsCreated: number;
  };
  errors: Array<{ transactionId: number; reason: string }>;
  nullPriceErrors?: Array<{
    transactionId: number;
    symbol: string;
    tradedAt: string;
    sourceType: string;
    canonicalType: string;
  }>;
  computedAt: string;
}
