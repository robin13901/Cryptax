/**
 * Engine-internal types for the FIFO tax calculation engine.
 * These types are NOT shared types — they exist only for in-memory processing.
 */
import type { Decimal } from 'decimal.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.js';
import type { CanonicalType, SourceType } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Database alias
// ---------------------------------------------------------------------------

export type Db = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// EngineTransaction
// ---------------------------------------------------------------------------

/**
 * Subset of transaction columns needed by engines.
 * eurPrice is non-null here because the null-price gate runs before the engine.
 */
export interface EngineTransaction {
  id: number;
  orderId: string | null;
  exchange: string;
  sourceType: SourceType;
  canonicalType: CanonicalType;
  symbol: string;
  side: string | null;
  amount: string;
  price: string;
  fee: string;
  totalValue: string;
  tradedAt: string;
  taxYear: number;
  /** Non-null because null-price gate ensures all taxable transactions have a price. */
  eurPrice: string;
}

// ---------------------------------------------------------------------------
// InMemoryLot
// ---------------------------------------------------------------------------

/**
 * In-memory FIFO lot for processing.
 * id is assigned after DB insert; use -1 as sentinel for "not yet persisted".
 */
export interface InMemoryLot {
  id: number;
  transactionId: number;
  /** Base asset, normalized (e.g. "BTC", "ETH"). */
  symbol: string;
  originalAmount: Decimal;
  remainingAmount: Decimal;
  costPerUnitEur: Decimal;
  feeEur: Decimal;
  /** ISO 8601 string. */
  acquiredAt: string;
  taxYear: number;
}

// ---------------------------------------------------------------------------
// ConsumptionRecord
// ---------------------------------------------------------------------------

/**
 * Records one lot-to-sell pairing during FIFO consumption.
 * lotIndex is the position in the lot array; mapped to DB id after insert.
 */
export interface ConsumptionRecord {
  /** Position in lot array — mapped to DB id after insert. */
  lotIndex: number;
  sellTransactionId: number;
  amountConsumed: Decimal;
  costBasisEur: Decimal;
  proceedsEur: Decimal;
  gainLossEur: Decimal;
  /** Allocated portion of the sell transaction fee. */
  feeEur: Decimal;
  heldDays: number;
  haltefristMet: boolean;
  taxYear: number;
}

// ---------------------------------------------------------------------------
// FifoEngineResult
// ---------------------------------------------------------------------------

export interface FifoEngineResult {
  lots: InMemoryLot[];
  consumptions: ConsumptionRecord[];
  sellsWithoutLots: Array<{
    transactionId: number;
    symbol: string;
    amount: string;
  }>;
  skipped: Array<{
    transactionId: number;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// SpotTaxResult
// ---------------------------------------------------------------------------

/** Per-year spot tax aggregation from §23 EStG private sales. */
export interface SpotTaxResult {
  taxYear: number;
  totalGainsEur: string;
  totalLossesEur: string;
  netGainEur: string;
  /** Gains from lots where haltefristMet = true — tax exempt. */
  taxFreeGainEur: string;
  taxableAmountEur: string;
  totalFeesEur: string;
  tradeCount: number;
}

// ---------------------------------------------------------------------------
// FuturesPnlResult
// ---------------------------------------------------------------------------

export interface FuturesPnlResult {
  positions: Array<{
    transactionId: number;
    symbol: string;
    realizedPnlEur: string;
    feeEur: string;
    taxYear: number;
  }>;
  skipped: Array<{
    transactionId: number;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// EarnIncomeResult
// ---------------------------------------------------------------------------

export interface EarnIncomeResult {
  incomeRecords: Array<{
    transactionId: number;
    symbol: string;
    amount: string;
    eurValueAtReceipt: string;
    receivedAt: string;
    taxYear: number;
  }>;
  /** Earn deposits create FIFO lots for future Haltefrist tracking. */
  lotsCreated: InMemoryLot[];
  skipped: Array<{
    transactionId: number;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// TaxCalculationResult
// ---------------------------------------------------------------------------

export interface TaxCalculationResult {
  fifo: FifoEngineResult;
  /** One SpotTaxResult per tax year processed. */
  spotTax: SpotTaxResult[];
  futures: FuturesPnlResult;
  earn: EarnIncomeResult;
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
  errors: Array<{
    transactionId: number;
    reason: string;
  }>;
}
