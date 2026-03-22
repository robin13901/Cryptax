import type { MoneyString } from './transaction.js';

/**
 * Tax bucket classification for German crypto tax law.
 * - private_sale: §23 EStG (Veräußerungsgeschäfte, 1-year Haltefrist)
 * - staking_earn: §22 Nr. 3 EStG (sonstige Einkünfte from earn/staking)
 * - futures_pnl: §15/§20 EStG (speculative futures gains)
 * - fee: deductible costs
 */
export type TaxBucket = 'private_sale' | 'staking_earn' | 'futures_pnl' | 'fee';

/**
 * A FIFO lot: one acquisition event that can be consumed against disposals.
 * All monetary fields are stored as TEXT strings for lossless arithmetic.
 */
export interface FifoLot {
  id: number;
  transactionId: number;
  symbol: string;
  exchange: string;
  acquiredAt: string;
  taxYear: number;
  /** Original acquired quantity */
  quantity: MoneyString;
  /** Remaining unconsumed quantity */
  remainingQuantity: MoneyString;
  /** Cost basis per unit in EUR */
  costBasisPerUnit: MoneyString;
  /** Total cost basis (quantity × costBasisPerUnit) */
  totalCostBasis: MoneyString;
  /** Fee allocated to this lot */
  feeAllocated: MoneyString;
  closedAt: string | null;
}

/**
 * Records how a disposal consumed one or more FIFO lots.
 */
export interface LotConsumption {
  id: number;
  disposalTransactionId: number;
  lotId: number;
  symbol: string;
  /** Quantity consumed from the lot */
  quantityConsumed: MoneyString;
  /** Cost basis for consumed quantity */
  costBasis: MoneyString;
  /** Proceeds allocated to this lot consumption */
  proceeds: MoneyString;
  /** Gross gain/loss (proceeds - costBasis) */
  gain: MoneyString;
  /** Days held (acquiredAt → disposalAt) */
  holdingDays: number;
  /** Tax-free because held ≥365 days */
  isTaxFree: boolean;
  taxBucket: TaxBucket;
  acquiredAt: string;
  disposedAt: string;
}

/**
 * Open or closed futures position for P&L tracking.
 */
export interface FuturesPosition {
  id: number;
  symbol: string;
  exchange: string;
  openedAt: string;
  closedAt: string | null;
  side: 'long' | 'short';
  /** Entry price in EUR */
  entryPrice: MoneyString;
  /** Closed entry price (weighted average for partial closes) */
  closedEntryPrice: MoneyString | null;
  /** Exit price in EUR */
  exitPrice: MoneyString | null;
  /** Original size */
  size: MoneyString;
  /** Realized P&L in EUR */
  realizedPnl: MoneyString | null;
  /** Funding fees accumulated */
  fundingFees: MoneyString;
  /** Trading fees accumulated */
  tradingFees: MoneyString;
  taxYear: number | null;
}

/**
 * Earn/staking income event (§22 Nr. 3 EStG).
 */
export interface EarnIncome {
  id: number;
  transactionId: number;
  symbol: string;
  exchange: string;
  earnedAt: string;
  taxYear: number;
  /** Quantity of crypto earned */
  quantity: MoneyString;
  /** Fair market value per unit at time of earning (EUR) */
  priceEurAtEarning: MoneyString;
  /** Total income = quantity × priceEurAtEarning */
  incomeEur: MoneyString;
  /** Freigrenze check (256 EUR annual threshold) */
  exceedsFreibetrag: boolean;
}

/**
 * Aggregated tax summary for a given tax year.
 * All monetary values in EUR, stored as strings.
 */
export interface TaxSummary {
  taxYear: number;
  /** Total proceeds from taxable disposals */
  totalProceeds: MoneyString;
  /** Total cost basis of disposed lots */
  totalCostBasis: MoneyString;
  /** Gross gain from §23 private sales */
  privateSaleGain: MoneyString;
  /** Gross loss from §23 private sales (negative value) */
  privateSaleLoss: MoneyString;
  /** Net §23 gain/loss (gain + loss) */
  privateSaleNet: MoneyString;
  /** Whether net §23 gain exceeds Freigrenze (1000 EUR) */
  privateSaleExceedsFreigrenze: boolean;
  /** Tax-free gains (held ≥365 days) */
  taxFreeGain: MoneyString;
  /** Futures realized P&L */
  futuresPnl: MoneyString;
  /** Earn/staking income total */
  earnIncomeTotal: MoneyString;
  /** Whether earn income exceeds Freigrenze (256 EUR) */
  earnExceedsFreigrenze: boolean;
  /** Total deductible fees */
  totalFees: MoneyString;
}

/**
 * Dashboard KPI card data.
 */
export interface DashboardKpi {
  taxYear: number;
  privateSaleNet: MoneyString;
  privateSaleExceedsFreigrenze: boolean;
  taxFreeGain: MoneyString;
  futuresPnl: MoneyString;
  earnIncomeTotal: MoneyString;
  earnExceedsFreigrenze: boolean;
  openLotsCount: number;
  unrealizedGain: MoneyString;
}
