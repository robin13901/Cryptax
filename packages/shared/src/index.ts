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
export type { EngineRunResponse } from './types/engine.js';
export type {
  ImportBatch,
  ImportFileError,
  ImportResponse,
  PerFileResult,
} from './types/import.js';
export type {
  EnrichmentResponse,
  ManualPriceEntry,
  PriceStatusResponse,
} from './types/price.js';
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
  EarnCoinBreakdown,
  EarnSummary,
  FuturesSummary,
  ReportData,
  SpotSummary,
  TradeAppendixRow,
} from './types/report.js';
export type { YearSummaryResponse } from './types/summary.js';
export type {
  CanonicalType,
  ImportError,
  ImportSummary,
  LotConsumptionDetail,
  MoneyString,
  PriceFailureReason,
  PriceSource,
  SourceType,
  Transaction,
  TransactionDetailResponse,
  TransactionListItem,
  TransactionPageResponse,
  TransactionSide,
} from './types/transaction.js';
