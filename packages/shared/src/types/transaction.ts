export type MoneyString = string;

export type SourceType = 'spot_tx' | 'futures_tx' | 'spot_order' | 'futures_order' | 'earn';

export type PriceSource =
  | 'bitget-direct'
  | 'bitget-usdt'
  | 'csv-fill'
  | 'csv-pair'
  | 'self'
  | 'coingecko'
  | 'manual'
  | null;

export type PriceFailureReason = 'no-bitget-pair' | 'coingecko-miss' | 'api-error' | null;

export type CanonicalType =
  | 'buy'
  | 'sell'
  | 'fee'
  | 'earn_deposit'
  | 'earn_interest'
  | 'earn_withdrawal'
  | 'futures_open_long'
  | 'futures_open_short'
  | 'futures_close_long'
  | 'futures_close_short'
  | 'futures_fee'
  | 'futures_funding'
  | 'transfer_in'
  | 'transfer_out'
  | 'unknown';

export type TransactionSide = 'buy' | 'sell' | null;

export interface Transaction {
  id: number;
  orderId: string;
  exchange: string;
  sourceType: SourceType;
  canonicalType: CanonicalType;
  symbol: string;
  side: TransactionSide;
  amount: MoneyString;
  price: MoneyString | null;
  fee: MoneyString;
  totalValue: MoneyString | null;
  tradedAt: string;
  taxYear: number;
  sourceFile: string | null;
  rawRow: string | null;
  checksum: string;
  importedAt: string;
  eurPrice: MoneyString | null;
  priceSource: PriceSource;
  priceResolvedAt: string | null;
  priceFailureReason: PriceFailureReason;
}

export interface TransactionListItem {
  id: number;
  orderId: string | null;
  symbol: string;
  canonicalType: CanonicalType;
  sourceType: SourceType;
  side: TransactionSide;
  amount: MoneyString;
  price: MoneyString | null;
  fee: MoneyString;
  eurPrice: MoneyString | null;
  tradedAt: string;
  taxYear: number;
  exchange: string;
}

/** Paginated transaction list response for GET /api/transactions */
export interface TransactionPageResponse {
  items: TransactionListItem[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

/** FIFO lot consumption detail for transaction detail view */
export interface LotConsumptionDetail {
  lotId: number;
  amountConsumed: MoneyString;
  costBasisEur: MoneyString;
  proceedsEur: MoneyString;
  gainLossEur: MoneyString;
  feeEur: MoneyString;
  heldDays: number;
  haltefristMet: boolean;
  /** Buy date from the FIFO lot */
  acquiredAt: string;
  /** Cost per unit from the FIFO lot */
  costPerUnitEur: MoneyString;
  /** Symbol from the FIFO lot */
  symbol: string;
}

/** Full transaction detail with tax impact */
export interface TransactionDetailResponse {
  transaction: Transaction;
  /** FIFO lot consumptions (for sell transactions) */
  lotConsumptions: LotConsumptionDetail[];
  /** Futures position data (for futures close transactions) */
  futuresPosition: {
    realizedPnlEur: MoneyString;
    feeEur: MoneyString;
  } | null;
  /** Earn income data (for earn transactions) */
  earnIncome: {
    amount: MoneyString;
    eurValueAtReceipt: MoneyString;
  } | null;
  /** Tax summary for this specific transaction */
  taxImpact: {
    bucket: 'private_sale' | 'futures_pnl' | 'staking_earn' | null;
    totalGainLossEur: MoneyString;
    isTaxFree: boolean;
    reason: string;
  };
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
  rawData?: string;
}

export interface ImportSummary {
  totalRows: number;
  imported: number;
  duplicatesSkipped: number;
  errorsSkipped: number;
  errors: ImportError[];
}
