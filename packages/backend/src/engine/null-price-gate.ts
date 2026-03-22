/**
 * Pre-flight NULL price gate for the FIFO tax engine.
 *
 * The engine requires EUR prices on all taxable transactions. This module
 * performs a pre-flight check that aborts engine execution if any taxable
 * transaction is missing its EUR price.
 *
 * Non-taxable canonical types are excluded from the check because the
 * enrichment pipeline intentionally skips them.
 */
import { and, inArray, isNull } from 'drizzle-orm';
import { transactions } from '../db/schema.js';
import type { Db } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical types that are skippable by the engine — they don't affect
 * capital gains or income tax calculations and may legitimately have no
 * EUR price.
 */
const SKIPPABLE_CANONICAL_TYPES = [
  'transfer_in',
  'transfer_out',
  'earn_withdrawal',
  'fee',
  'unknown',
] as const;

/**
 * Canonical types that MUST have an EUR price for correct tax computation.
 * If any of these have NULL eurPrice, the engine must abort.
 */
const TAXABLE_CANONICAL_TYPES = [
  'buy',
  'sell',
  'earn_interest',
  'earn_deposit',
  'futures_open_long',
  'futures_open_short',
  'futures_close_long',
  'futures_close_short',
  'futures_fee',
  'futures_funding',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Diagnostic information for a transaction missing its EUR price.
 * Returned by checkNullPrices() to help the caller identify which
 * transactions need price enrichment before the engine can run.
 */
export interface NullPriceError {
  transactionId: number;
  symbol: string;
  tradedAt: string;
  sourceType: string;
  canonicalType: string;
}

// ---------------------------------------------------------------------------
// checkNullPrices
// ---------------------------------------------------------------------------

/**
 * Pre-flight check: query the transactions table for taxable rows that are
 * missing their EUR price.
 *
 * @param db - Drizzle database instance
 * @returns Array of NullPriceError for each offending transaction.
 *          Empty array means the gate passes — engine may proceed.
 *
 * @example
 * const errors = checkNullPrices(db);
 * if (errors.length > 0) {
 *   throw new Error(`Cannot run engine: ${errors.length} transactions missing EUR price`);
 * }
 */
export function checkNullPrices(db: Db): NullPriceError[] {
  const rows = db
    .select({
      id: transactions.id,
      symbol: transactions.symbol,
      tradedAt: transactions.tradedAt,
      sourceType: transactions.sourceType,
      canonicalType: transactions.canonicalType,
    })
    .from(transactions)
    .where(
      // Only check taxable types — non-taxable types may have NULL eurPrice
      and(
        isNull(transactions.eurPrice),
        inArray(transactions.canonicalType, TAXABLE_CANONICAL_TYPES as unknown as string[])
      )
    )
    .all();

  return rows.map((row) => ({
    transactionId: row.id,
    symbol: row.symbol,
    tradedAt: row.tradedAt,
    sourceType: row.sourceType,
    canonicalType: row.canonicalType,
  }));
}

// Re-export skippable types for consumers that need to know which types are excluded
export { SKIPPABLE_CANONICAL_TYPES, TAXABLE_CANONICAL_TYPES };
