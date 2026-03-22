import type { CanonicalType, SourceType } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// CANONICAL_TYPE_MAP
// ---------------------------------------------------------------------------

/**
 * Complete mapping of raw Bitget type strings (per CSV format) to canonical
 * transaction types used throughout the Cryptax domain.
 *
 * All 22 known type strings extracted from actual Bitget CSV exports are
 * covered. Unknown or future type strings are handled at lookup time via
 * `mapCanonicalType` which falls back to 'unknown'.
 *
 * Key decisions:
 * - futures_tx 'risk_captital_user_transfer' is intentionally misspelled —
 *   this is Bitget's exact typo in the CSV; correcting it would break mapping.
 * - spot_tx 'Exchange income' / 'Exchange spending' represent swap pair legs.
 * - spot_tx 'Position profit' is futures PnL settled to spot wallet.
 */
export const CANONICAL_TYPE_MAP: Record<SourceType, Record<string, CanonicalType>> = {
  spot_tx: {
    Buy: 'buy',
    Sell: 'sell',
    Interest: 'earn_interest',
    Gains: 'earn_interest',
    Financial: 'transfer_in',
    Deposit: 'transfer_in',
    'Deposit credited': 'transfer_in',
    'Automatic deposit': 'transfer_in',
    'Transfer out': 'transfer_out',
    'Automatic withdrawal': 'transfer_out',
    Consumption: 'transfer_out',
    'Position profit': 'futures_funding',
    'Exchange income': 'buy',
    'Exchange spending': 'sell',
  },

  futures_tx: {
    open_long: 'futures_open_long',
    open_short: 'futures_open_short',
    close_long: 'futures_close_long',
    close_short: 'futures_close_short',
    burst_close_short: 'futures_close_short',
    contract_main_settle_fee: 'futures_funding',
    trans_from_exchange: 'transfer_in',
    transfer_from_future_copytrade: 'transfer_in',
    // Note: "captital" is Bitget's exact typo — do NOT correct this spelling
    risk_captital_user_transfer: 'transfer_in',
  },

  earn: {
    Staking: 'earn_deposit',
  },

  spot_order: {
    Buy: 'buy',
    Sell: 'sell',
  },

  futures_order: {
    'Open long': 'futures_open_long',
    'Close long': 'futures_close_long',
    'Open short': 'futures_open_short',
    'Close short': 'futures_close_short',
  },
};

// ---------------------------------------------------------------------------
// mapCanonicalType
// ---------------------------------------------------------------------------

/**
 * Look up the canonical type for a raw Bitget type string.
 *
 * Type string matching is case-sensitive — Bitget uses exact casing in CSV
 * exports (e.g. 'Buy' not 'buy', 'Open long' not 'Open Long').
 *
 * @param sourceType - The format of the source CSV file.
 * @param rawType    - The raw type string as-is from the CSV row.
 * @returns The matching {@link CanonicalType}, or 'unknown' for unrecognised strings.
 */
export function mapCanonicalType(sourceType: SourceType, rawType: string): CanonicalType {
  return CANONICAL_TYPE_MAP[sourceType][rawType] ?? 'unknown';
}
