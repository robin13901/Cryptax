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
  symbol: string;
  canonicalType: CanonicalType;
  side: TransactionSide;
  amount: MoneyString;
  price: MoneyString | null;
  fee: MoneyString;
  tradedAt: string;
  taxYear: number;
  exchange: string;
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
