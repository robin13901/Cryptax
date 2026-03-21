import { describe, expect, it } from 'vitest';
import { parseSpotTx } from './spot-tx.js';
import type { ParsedSpotTx } from './spot-tx.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid spot-tx row using 2025 column casing (lowercase 'order') */
function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    order: '1252628755991928841',
    Date: '2024-12-16 20:04:48',
    Coin: 'USDT',
    Type: 'Buy',
    Amount: '160',
    Fee: '-0.16',
    Available: '163.73784613735',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic happy-path cases
// ---------------------------------------------------------------------------

describe('parseSpotTx - happy path', () => {
  it('parses a valid Buy row', () => {
    const result = parseSpotTx([makeRow()], 'test-2024.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions).toHaveLength(1);

    const tx: ParsedSpotTx = result.transactions[0];
    expect(tx.orderId).toBe('1252628755991928841');
    expect(tx.tradedAt).toBe('2024-12-16 20:04:48');
    expect(tx.symbol).toBe('USDT');
    expect(tx.rawType).toBe('Buy');
    expect(tx.amount).toBe('160');
    expect(tx.fee).toBe('-0.16');
    expect(tx.available).toBe('163.73784613735');
    expect(tx.sourceFile).toBe('test-2024.csv');
  });

  it('parses a Sell row with negative amount', () => {
    const row = makeRow({ Coin: 'EUR', Type: 'Sell', Amount: '-151.488', Fee: '0' });
    const result = parseSpotTx([row], 'test-sell.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].amount).toBe('-151.488');
    expect(result.transactions[0].rawType).toBe('Sell');
  });

  it('parses an Interest row with positive amount', () => {
    const row = makeRow({
      Coin: 'USDE',
      Type: 'Interest',
      Amount: '0.00067825',
      Fee: '0',
      Available: '0.61142511',
    });
    const result = parseSpotTx([row], 'test-interest.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].rawType).toBe('Interest');
    expect(result.transactions[0].amount).toBe('0.00067825');
  });

  it('preserves all fields on a fully-populated row', () => {
    const result = parseSpotTx(
      [makeRow({ Available: '163.73784613735' })],
      'full-row.csv',
    );

    const tx = result.transactions[0];
    expect(tx.available).toBe('163.73784613735');
    expect(tx.sourceFile).toBe('full-row.csv');
  });

  it('parses multiple valid rows', () => {
    const rows = [
      makeRow({ order: '111', Amount: '10' }),
      makeRow({ order: '222', Amount: '-20' }),
      makeRow({ order: '333', Amount: '30' }),
    ];
    const result = parseSpotTx(rows, 'multi.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((t) => t.orderId)).toEqual(['111', '222', '333']);
  });
});

// ---------------------------------------------------------------------------
// Tab-prefix handling (csv-parse trim should already strip it, but we verify)
// ---------------------------------------------------------------------------

describe('parseSpotTx - tab-stripped order IDs', () => {
  it('strips leading tab from order ID if present', () => {
    const row = makeRow({ order: '\t1252628755991928841' });
    const result = parseSpotTx([row], 'tab-test.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].orderId).toBe('1252628755991928841');
    expect(result.transactions[0].orderId).not.toMatch(/^\t/);
  });

  it('leaves clean order ID unchanged', () => {
    const row = makeRow({ order: '1252628755991928841' });
    const result = parseSpotTx([row], 'clean-id.csv');
    expect(result.transactions[0].orderId).toBe('1252628755991928841');
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive column handling
// ---------------------------------------------------------------------------

describe('parseSpotTx - case-insensitive column keys', () => {
  it('accepts lowercase "order" key (2025 format)', () => {
    const row = makeRow({ order: '9001' });
    const result = parseSpotTx([row], 'lowercase.csv');
    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].orderId).toBe('9001');
  });

  it('accepts uppercase "Order" key (mixed-case format)', () => {
    const rowUpperCase: Record<string, string> = {
      Order: '9002',
      Date: '2024-01-01 00:00:00',
      Coin: 'BTC',
      Type: 'Buy',
      Amount: '0.001',
      Fee: '0',
      Available: '0.001',
    };
    const result = parseSpotTx([rowUpperCase], 'uppercase.csv');
    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].orderId).toBe('9002');
  });
});

// ---------------------------------------------------------------------------
// Missing / empty required fields → errors
// ---------------------------------------------------------------------------

describe('parseSpotTx - validation errors', () => {
  it('produces error for row with missing order field', () => {
    const row: Record<string, string> = {
      Date: '2024-12-16 20:04:48',
      Coin: 'USDT',
      Type: 'Buy',
      Amount: '100',
      Fee: '0',
      Available: '100',
    };
    const result = parseSpotTx([row], 'error-test.csv');

    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(0);
    expect(result.errors[0].field).toBe('order');
  });

  it('produces error for row with empty order field', () => {
    const row = makeRow({ order: '' });
    const result = parseSpotTx([row], 'empty-order.csv');

    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].field).toBe('order');
  });

  it('produces error for row with missing Date', () => {
    const row: Record<string, string> = {
      order: '999',
      Coin: 'USDT',
      Type: 'Buy',
      Amount: '100',
      Fee: '0',
      Available: '100',
    };
    const result = parseSpotTx([row], 'no-date.csv');

    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].field).toBe('Date');
  });

  it('produces error for row with empty Amount', () => {
    const row = makeRow({ Amount: '' });
    const result = parseSpotTx([row], 'empty-amount.csv');

    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].field).toBe('Amount');
  });

  it('collects multiple errors across rows, valid rows still parsed', () => {
    const rows = [
      makeRow({ order: '' }),       // invalid — row 0
      makeRow({ order: '100' }),    // valid — row 1
      makeRow({ Amount: '' }),      // invalid — row 2
      makeRow({ order: '200' }),    // valid — row 3
    ];
    const result = parseSpotTx(rows, 'mixed.csv');

    expect(result.errors).toHaveLength(2);
    expect(result.transactions).toHaveLength(2);
    expect(result.errors[0].row).toBe(0);
    expect(result.errors[1].row).toBe(2);
    expect(result.transactions.map((t) => t.orderId)).toEqual(['100', '200']);
  });

  it('error object has row, field, and message properties', () => {
    const row = makeRow({ Amount: '' });
    const result = parseSpotTx([row], 'err-shape.csv');

    const err = result.errors[0];
    expect(err).toHaveProperty('row');
    expect(err).toHaveProperty('field');
    expect(err).toHaveProperty('message');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Actual CSV fixture data
// ---------------------------------------------------------------------------

describe('parseSpotTx - real CSV fixture rows', () => {
  // Actual rows from 2024 spot CSV (semicolon-delimited, pre-parsed by csv-parse)
  // csv-parse with { trim: true, bom: true } strips the leading \t from order col
  it('parses 2024 spot fixture row (Interest, after csv-parse trim)', () => {
    const row2024: Record<string, string> = {
      order: '1258113040865390595',   // tab already stripped by csv-parse trim
      Date: '2024-12-31 23:17:21',
      Coin: 'USDE',
      Type: 'Interest',
      Amount: '0.00067825',
      Fee: '0',
      Available: '0.61142511',
    };
    const result = parseSpotTx([row2024], '2024 Export spot transactions.csv');

    expect(result.errors).toHaveLength(0);
    const tx = result.transactions[0];
    expect(tx.orderId).toBe('1258113040865390595');
    expect(tx.tradedAt).toBe('2024-12-31 23:17:21');
    expect(tx.symbol).toBe('USDE');
    expect(tx.rawType).toBe('Interest');
    expect(tx.amount).toBe('0.00067825');
    expect(tx.fee).toBe('0');
    expect(tx.sourceFile).toBe('2024 Export spot transactions.csv');
  });

  it('parses 2025 spot fixture row (Sell, after csv-parse trim)', () => {
    const row2025: Record<string, string> = {
      order: '1389650902004740097',   // tab already stripped by csv-parse trim
      Date: '2025-12-29 22:41:54',
      Coin: 'EUR',
      Type: 'Sell',
      Amount: '-37.06153',
      Fee: '0',
      Available: '0.66601',
    };
    const result = parseSpotTx([row2025], 'Export spot transactions-2026-01-05 05_40_51.csv');

    expect(result.errors).toHaveLength(0);
    const tx = result.transactions[0];
    expect(tx.orderId).toBe('1389650902004740097');
    expect(tx.tradedAt).toBe('2025-12-29 22:41:54');
    expect(tx.symbol).toBe('EUR');
    expect(tx.rawType).toBe('Sell');
    expect(tx.amount).toBe('-37.06153');
    expect(tx.sourceFile).toBe('Export spot transactions-2026-01-05 05_40_51.csv');
  });

  it('produces identical ParsedSpotTx structure from 2024 and 2025 formats', () => {
    // Same logical transaction represented in 2024 (semicolon) and 2025 (comma) format
    // After csv-parse normalises both, the row objects look identical
    const sharedRow: Record<string, string> = {
      order: '9999999999999999999',
      Date: '2024-06-15 12:00:00',
      Coin: 'BTC',
      Type: 'Buy',
      Amount: '0.0005',
      Fee: '-0.0000005',
      Available: '0.0004995',
    };

    const result2024 = parseSpotTx([{ ...sharedRow }], '2024 Export spot transactions.csv');
    const result2025 = parseSpotTx([{ ...sharedRow }], 'Export spot transactions-2026-01-05 05_40_51.csv');

    // Both produce a valid transaction
    expect(result2024.errors).toHaveLength(0);
    expect(result2025.errors).toHaveLength(0);

    // Structural fields are identical (excluding sourceFile which reflects filename)
    const tx2024 = result2024.transactions[0];
    const tx2025 = result2025.transactions[0];
    expect(tx2024.orderId).toBe(tx2025.orderId);
    expect(tx2024.tradedAt).toBe(tx2025.tradedAt);
    expect(tx2024.symbol).toBe(tx2025.symbol);
    expect(tx2024.rawType).toBe(tx2025.rawType);
    expect(tx2024.amount).toBe(tx2025.amount);
    expect(tx2024.fee).toBe(tx2025.fee);
    expect(tx2024.available).toBe(tx2025.available);
  });

  it('parses 2025 Buy fixture row (BTC)', () => {
    const row: Record<string, string> = {
      order: '1389650902004740096',
      Date: '2025-12-29 22:41:54',
      Coin: 'BTC',
      Type: 'Buy',
      Amount: '0.0005',
      Fee: '-0.0000005',
      Available: '0.0004995',
    };
    const result = parseSpotTx([row], 'Export spot transactions-2026-01-05 05_40_51.csv');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions[0].amount).toBe('0.0005');
    expect(result.transactions[0].rawType).toBe('Buy');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('parseSpotTx - edge cases', () => {
  it('handles empty rows array', () => {
    const result = parseSpotTx([], 'empty.csv');
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('does not throw on completely empty row object', () => {
    const result = parseSpotTx([{}], 'empty-row.csv');
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('preserves signed negative amounts as-is', () => {
    const row = makeRow({ Amount: '-999.99' });
    const result = parseSpotTx([row], 'neg.csv');
    expect(result.transactions[0].amount).toBe('-999.99');
  });

  it('preserves zero amount strings', () => {
    const row = makeRow({ Amount: '0', Fee: '0' });
    const result = parseSpotTx([row], 'zero.csv');
    expect(result.transactions[0].amount).toBe('0');
    expect(result.transactions[0].fee).toBe('0');
  });
});
