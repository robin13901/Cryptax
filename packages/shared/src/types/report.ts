import type { MoneyString } from './transaction.js';

/**
 * Top-level container for a single tax year's report data.
 * Aggregates all three tax buckets plus the full trade appendix.
 *
 * This is the data foundation for JSON preview, PDF, and CSV outputs.
 * Generated once by ReportGenerator.generate(year) and consumed by all
 * downstream report formatters.
 */
export interface ReportData {
  /** The tax year this report covers (e.g. 2024). */
  taxYear: number;
  /** ISO 8601 timestamp when the report was generated. */
  generatedAt: string;
  /** §23 EStG — Spot trades (Veräußerungsgeschäfte). */
  spotSummary: SpotSummary;
  /** §20 EStG — Futures P&L (Kapitalerträge, Abgeltungssteuer). */
  futuresSummary: FuturesSummary;
  /** §22 Nr. 3 EStG — Earn/staking income (sonstige Einkünfte). */
  earnSummary: EarnSummary;
  /**
   * Full trade appendix — ALL lot consumptions for the year,
   * including both taxable and tax-free (Haltefrist-met) trades.
   * Sorted by sellDate ASC, then symbol ASC.
   */
  tradeAppendix: TradeAppendixRow[];
  /**
   * Full futures appendix — ALL closed futures positions, funding payments,
   * and fee records for the year.
   * Sorted by date ASC, then symbol ASC.
   */
  futuresAppendix: FuturesAppendixRow[];
}

/**
 * §23 EStG summary — Spot trades (Anlage SO).
 *
 * Freigrenze cliff: if netEur <= 1000 EUR the entire amount is tax-free.
 * When freigrenzeStatus = 'under', taxableAmountEur will be '0'.
 */
export interface SpotSummary {
  /** Sum of all gains from non-haltefrist-met disposals (positive). */
  totalGainsEur: MoneyString;
  /** Sum of all losses from non-haltefrist-met disposals (negative). */
  totalLossesEur: MoneyString;
  /** Net gain/loss (totalGainsEur + totalLossesEur). */
  netEur: MoneyString;
  /**
   * Taxable amount after Freigrenze cliff.
   * Equals netEur when freigrenzeStatus = 'over', '0' when 'under'.
   */
  taxableAmountEur: MoneyString;
  /** Annual §23 Freigrenze threshold — always '1000'. */
  freigrenzeLimitEur: MoneyString;
  /**
   * 'under'  → net gain ≤ 1000 EUR, entire amount tax-free (cliff).
   * 'over'   → net gain > 1000 EUR, full amount taxable.
   */
  freigrenzeStatus: 'under' | 'over';
  /** Total number of FIFO lot consumptions (disposal records) processed. */
  tradeCount: number;
  /**
   * Number of lot consumptions where haltefristMet = true
   * (held >= 366 days — tax-free regardless of Freigrenze).
   */
  taxFreeTradeCount: number;
}

/**
 * §20 EStG summary — Futures P&L (Anlage KAP).
 *
 * Futures gains are subject to Abgeltungssteuer (26.375%).
 * No Freigrenze applies; positive net is fully taxable.
 */
export interface FuturesSummary {
  /** Sum of profitable closed positions (positive). */
  totalGainsEur: MoneyString;
  /** Sum of losing closed positions (negative). */
  totalLossesEur: MoneyString;
  /** Net P&L across all positions. */
  netEur: MoneyString;
  /**
   * Taxable amount — equals netEur when positive, '0' when net loss.
   * No Freigrenze for futures income.
   */
  taxableAmountEur: MoneyString;
  /** Total fees (trading + funding) deducted from gross P&L. */
  totalFeesEur: MoneyString;
  /**
   * Estimated Abgeltungssteuer (26.375% × taxableAmountEur).
   * Only computed when taxableAmountEur > 0.
   */
  estimatedTaxEur: MoneyString;
  /** Total number of closed futures positions. */
  tradeCount: number;
}

/**
 * §22 Nr. 3 EStG summary — Earn/staking income.
 *
 * Freigrenze cliff: if totalIncomeEur <= 256 EUR the entire amount is tax-free.
 * When freigrenzeStatus = 'under', taxableAmountEur in the DB row will be '0'.
 */
export interface EarnSummary {
  /**
   * Total earn income — sum of eurValueAtReceipt across all earn records
   * for the year (regardless of Freigrenze status).
   */
  totalIncomeEur: MoneyString;
  /** Annual §22 Freigrenze threshold — always '256'. */
  freigrenzeLimitEur: MoneyString;
  /**
   * 'under'  → total income ≤ 256 EUR, entirely tax-free (cliff).
   * 'over'   → total income > 256 EUR, full amount taxable.
   */
  freigrenzeStatus: 'under' | 'over';
  /** Total number of earn income records for the year. */
  recordCount: number;
  /** Breakdown by coin symbol. */
  perCoinBreakdown: EarnCoinBreakdown[];
}

/** Per-coin earn income aggregate within an EarnSummary. */
export interface EarnCoinBreakdown {
  /** Coin symbol (e.g. 'ETH', 'SOL'). */
  symbol: string;
  /** Total EUR value of earn income for this coin. */
  totalEur: MoneyString;
  /** Number of earn records for this coin. */
  count: number;
}

/**
 * One row in the trade appendix — represents a single FIFO lot consumption.
 *
 * Includes ALL trades for the year: both taxable (haltefristMet = false)
 * and tax-free (haltefristMet = true). Haltefrist-met trades are clearly
 * marked so the Steuerberater can see the full picture.
 */
export interface TradeAppendixRow {
  /** lot_consumptions.id — stable row identifier. */
  id: number;
  /** sell transaction ID — used for grouping lot consumptions from the same sale. */
  sellTransactionId: number;
  /** Base asset symbol (e.g. 'BTC', 'ETH'). */
  symbol: string;
  /** ISO 8601 — date the lot was acquired (fifo_lots.acquired_at). */
  buyDate: string;
  /** ISO 8601 — date the lot was sold (transactions.traded_at). */
  sellDate: string;
  /** Quantity of the asset consumed in this lot pairing. */
  amountConsumed: MoneyString;
  /** EUR cost basis for the consumed quantity. */
  costBasisEur: MoneyString;
  /** EUR proceeds allocated to this lot consumption. */
  proceedsEur: MoneyString;
  /** EUR gain or loss (proceedsEur − costBasisEur). Positive = gain. */
  gainLossEur: MoneyString;
  /** EUR fees allocated to this consumption. */
  feeEur: MoneyString;
  /** Number of days the lot was held before disposal. */
  heldDays: number;
  /**
   * true  → held ≥ 366 days, tax-free under §23 EStG Haltefrist rule.
   * false → held < 366 days, taxable (subject to Freigrenze).
   */
  haltefristMet: boolean;
  /** Exchange where the sell occurred. */
  exchange: string;
}

/**
 * One row in the futures appendix — represents a single closed futures position,
 * funding payment, or fee record.
 *
 * Unlike spot trades, futures have no FIFO lot matching.
 * Each record is a standalone P&L event.
 */
export interface FuturesAppendixRow {
  /** futures_positions.id — stable row identifier. */
  id: number;
  /** FK to transactions table. */
  transactionId: number;
  /** Base asset symbol (e.g. 'BTC', 'ETH'). */
  symbol: string;
  /** ISO 8601 — date/time of the transaction (transactions.traded_at). */
  date: string;
  /** Human-readable direction: 'Close Long', 'Close Short', 'Funding', or 'Gebühr'. */
  direction: string;
  /** Realized P&L in EUR (positive = profit, negative = loss). */
  realizedPnlEur: MoneyString;
  /** Trading/funding fees in EUR. */
  feeEur: MoneyString;
  /** Exchange where the position was closed. */
  exchange: string;
}
