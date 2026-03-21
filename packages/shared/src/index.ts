// @cryptax/shared — domain types and utilities

export type { SupportedExchange } from './constants/index.js';
export { TAX_CONSTANTS } from './constants/index.js';

export {
  addMoney,
  compareMoney,
  Decimal,
  fromDecimal,
  isNegative,
  isZero,
  multiplyMoney,
  subtractMoney,
  toDecimal,
  ZERO,
} from './decimal/index.js';
export type {
  DashboardKpi,
  EarnIncome,
  FifoLot,
  FuturesPosition,
  LotConsumption,
  TaxBucket,
  TaxSummary,
} from './types/tax.js';
export type {
  CanonicalType,
  ImportError,
  ImportSummary,
  MoneyString,
  SourceType,
  Transaction,
  TransactionListItem,
  TransactionSide,
} from './types/transaction.js';
