// ---------------------------------------------------------------------------
// Price enrichment shared types
// ---------------------------------------------------------------------------

export interface PriceStatusResponse {
  total: number;
  resolved: number;
  unresolved: number;
  bySource: Record<string, number>;
  failureBreakdown: Record<string, number>;
  unresolvedTransactions: Array<{
    id: number;
    symbol: string;
    tradedAt: string;
    failureReason: string | null;
  }>;
}

export interface EnrichmentResponse {
  total: number;
  resolved: number;
  failed: number;
  bySource: Record<string, number>;
  failures: Array<{ transactionId: number; symbol: string; reason: string }>;
}

export interface ManualPriceEntry {
  transactionId: number;
  eurPrice: string;
}
