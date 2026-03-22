/**
 * German crypto tax law constants (Einkommensteuergesetz).
 */
export const TAX_CONSTANTS = {
  /**
   * §23 EStG: Minimum holding period for tax-free private sales.
   * Assets held >= 366 days are exempt from capital gains tax.
   * Conservative interpretation: bought Jan 1 → tax-free from Jan 2 next year
   * (366 days elapsed, not merely 365 calendar days since the buy date).
   */
  HALTEFRIST_DAYS: 366,

  /**
   * §23 EStG: Annual Freigrenze for private sales (Veräußerungsgeschäfte).
   * If total net gains ≤ 1000 EUR, no tax is owed (complete exemption, not deduction).
   * Note: From tax year 2024 increased from 600 EUR to 1000 EUR.
   */
  SPOT_FREIGRENZE_EUR: '1000',

  /**
   * §22 Nr. 3 EStG: Annual Freigrenze for miscellaneous income (sonstige Einkünfte).
   * Earn/staking income ≤ 256 EUR per year is tax-free.
   */
  EARN_FREIGRENZE_EUR: '256',

  /**
   * Abgeltungsteuer rate: 25% + 5.5% Solidaritätszuschlag = 26.375%.
   * Applies to futures/CFD gains (Kapitalerträge §20 EStG).
   * Stored as string for Decimal arithmetic.
   */
  ABGELTUNGSSTEUER_RATE: '0.26375',

  /**
   * Supported exchanges for CSV import.
   */
  EXCHANGES: ['bitget'] as const,
} as const;

export type SupportedExchange = (typeof TAX_CONSTANTS.EXCHANGES)[number];
