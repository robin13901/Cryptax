/**
 * Format a MoneyString or number as German locale EUR currency.
 * Input: "1234.56" or 1234.56
 * Output: "1.234,56 EUR"
 */
export function formatEur(value: string | number, showSign = false): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '--';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    signDisplay: showSign ? 'exceptZero' : 'auto',
  }).format(num);
}

/**
 * Format a number in German locale without currency symbol.
 */
export function formatNumber(value: string | number, decimals = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '--';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format a ratio as percentage in German locale.
 */
export function formatPercent(value: number, decimals = 1): string {
  if (Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('de-DE', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Determine CSS color variable for a monetary value.
 * Positive = green, negative = red, zero = neutral.
 */
export function gainLossColor(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num) || num === 0) return 'var(--text-secondary, rgba(255,255,255,0.6))';
  return num > 0 ? 'var(--crypto-green)' : 'var(--crypto-red)';
}
