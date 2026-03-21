import Decimal from 'decimal.js';

/**
 * Configure Decimal.js globally for monetary arithmetic.
 * - precision: 36 digits (sufficient for crypto quantities and EUR values)
 * - rounding: ROUND_HALF_UP (matches German tax authority rounding conventions)
 */
Decimal.set({ precision: 36, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** A string representation of a monetary/quantity value. */
export type MoneyString = string;

/** Zero value as a Decimal constant. */
export const ZERO = new Decimal(0);

/**
 * Convert a MoneyString (or number) to a Decimal for arithmetic.
 * Use this whenever reading a monetary value from the database or API.
 */
export function toDecimal(value: MoneyString | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0);
  }
  return new Decimal(value);
}

/**
 * Convert a Decimal back to a MoneyString for storage in the database or JSON.
 * Uses the full precision string representation (no exponential notation).
 */
export function fromDecimal(value: Decimal): MoneyString {
  return value.toFixed();
}

/**
 * Add two MoneyString values. Returns a MoneyString.
 */
export function addMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromDecimal(toDecimal(a).plus(toDecimal(b)));
}

/**
 * Subtract b from a. Returns a MoneyString.
 */
export function subtractMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromDecimal(toDecimal(a).minus(toDecimal(b)));
}

/**
 * Multiply two MoneyString values. Returns a MoneyString.
 */
export function multiplyMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromDecimal(toDecimal(a).times(toDecimal(b)));
}

/**
 * Compare two MoneyString values.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  const result = toDecimal(a).comparedTo(toDecimal(b));
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

/**
 * Returns true if value equals zero.
 */
export function isZero(value: MoneyString): boolean {
  return toDecimal(value).isZero();
}

/**
 * Returns true if value is negative (less than zero).
 */
export function isNegative(value: MoneyString): boolean {
  return toDecimal(value).isNegative();
}
