import type { MoneyString } from './transaction.js';

export interface YearSummaryResponse {
  taxYear: number;
  availableYears: number[];
  engineHasRun: boolean;

  // Per-bucket summaries (from tax_summaries table)
  buckets: Array<{
    bucket: 'private_sale' | 'futures_pnl' | 'staking_earn';
    totalGainsEur: MoneyString;
    totalLossesEur: MoneyString;
    netEur: MoneyString;
    taxableAmountEur: MoneyString;
    estimatedTaxEur: MoneyString;
    tradeCount: number;
  }>;

  // Aggregated KPIs (derived from buckets)
  totalNetEur: MoneyString;
  totalTradeCount: number;
  totalTaxableEur: MoneyString;
  totalEstimatedTaxEur: MoneyString;

  // Chart data: monthly spot gains/losses (DASH-02, DASH-05)
  monthlySpot: Array<{ month: string; gains: MoneyString; losses: MoneyString }>;
  // Chart data: monthly futures P&L (DASH-05, DASH-06)
  monthlyFutures: Array<{ month: string; pnl: MoneyString }>;
  // Chart data: daily combined P&L for cumulative chart (spot + futures net per day)
  dailyPnl: Array<{ date: string; net: MoneyString }>;
  // Chart data: per-coin gain/loss (DASH-04)
  perCoinGainLoss: Array<{ symbol: string; net: MoneyString }>;
  // Chart data: portfolio allocation from open lots (DASH-03)
  portfolioAllocation: Array<{ symbol: string; valueEur: MoneyString }>;
  // Chart data: year-over-year comparison (DASH-08)
  yearOverYear: Array<{
    taxYear: number;
    spotNet: MoneyString;
    futuresNet: MoneyString;
    earnNet: MoneyString;
  }>;

  // Freigrenze progress
  spotFreigrenzeEur: MoneyString; // "1000"
  earnFreigrenzeEur: MoneyString; // "256"
  spotNetForFreigrenze: MoneyString; // net gain for §23 (non-exempt only)
  earnTotalForFreigrenze: MoneyString; // total earn income for §22

  // Last engine computation timestamp (ISO string)
  computedAt: string | null;
}
