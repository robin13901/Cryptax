import { describe, expect, it } from 'vitest';
import type { ParsedFuturesOrder } from './futures-order.js';
import { parseFuturesOrder } from './futures-order.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    Date: '2024-09-15 10:23:45',
    'Order ID': '1234567890',
    Direction: 'Open long',
    Coin: 'USDT',
    Futures: 'BTCUSDT',
    'order source': 'Normal',
    'Transaction type': 'Limit',
    Price: '58000',
    'Average Price': '58000',
    'Order amount': '0.001',
    Executed: '0.001',
    'Trading volume': '58',
    'Realized P/L': '0',
    NetProfits: '0',
    Status: 'Filled',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Direction → rawType mapping
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – direction mapping', () => {
  it('maps Open long to rawType "Open long"', () => {
    const { transactions, errors } = parseFuturesOrder(
      [makeRow({ Direction: 'Open long' })],
      'test.csv'
    );
    expect(errors).toHaveLength(0);
    expect(transactions[0].rawType).toBe('Open long');
    expect(transactions[0].futures).toBe('BTCUSDT');
  });

  it('maps Close long to rawType "Close long" and captures realizedPnl', () => {
    const { transactions, errors } = parseFuturesOrder(
      [makeRow({ Direction: 'Close long', 'Realized P/L': '12.5', NetProfits: '12.0' })],
      'test.csv'
    );
    expect(errors).toHaveLength(0);
    expect(transactions[0].rawType).toBe('Close long');
    expect(transactions[0].realizedPnl).toBe('12.5');
    expect(transactions[0].netProfits).toBe('12.0');
  });

  it('maps Open short to rawType "Open short"', () => {
    const { transactions, errors } = parseFuturesOrder(
      [makeRow({ Direction: 'Open short' })],
      'test.csv'
    );
    expect(errors).toHaveLength(0);
    expect(transactions[0].rawType).toBe('Open short');
  });

  it('maps Close short to rawType "Close short" and captures netProfits', () => {
    const { transactions, errors } = parseFuturesOrder(
      [makeRow({ Direction: 'Close short', 'Realized P/L': '-5', NetProfits: '-5.1' })],
      'test.csv'
    );
    expect(errors).toHaveLength(0);
    expect(transactions[0].rawType).toBe('Close short');
    expect(transactions[0].netProfits).toBe('-5.1');
  });
});

// ---------------------------------------------------------------------------
// ParsedFuturesOrder field mapping
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – field mapping', () => {
  it('maps all standard columns correctly', () => {
    const row = makeRow();
    const { transactions, errors } = parseFuturesOrder([row], 'import.csv');
    expect(errors).toHaveLength(0);
    const tx = transactions[0];
    expect(tx.orderId).toBe('1234567890');
    expect(tx.tradedAt).toBe('2024-09-15 10:23:45');
    expect(tx.coin).toBe('USDT');
    expect(tx.futures).toBe('BTCUSDT');
    expect(tx.orderSource).toBe('Normal');
    expect(tx.transactionType).toBe('Limit');
    expect(tx.price).toBe('58000');
    expect(tx.amount).toBe('0.001');
    expect(tx.executed).toBe('0.001');
    expect(tx.tradingVolume).toBe('58');
    expect(tx.realizedPnl).toBe('0');
    expect(tx.netProfits).toBe('0');
    expect(tx.status).toBe('Filled');
    expect(tx.sourceFile).toBe('import.csv');
  });

  it('captures Realized P/L as "0" for open orders', () => {
    const { transactions } = parseFuturesOrder(
      [makeRow({ Direction: 'Open long', 'Realized P/L': '0' })],
      'test.csv'
    );
    expect(transactions[0].realizedPnl).toBe('0');
  });

  it('strips tab from Order ID', () => {
    const { transactions } = parseFuturesOrder(
      [makeRow({ 'Order ID': '\t9876543210' })],
      'test.csv'
    );
    // parseFuturesOrder receives pre-parsed rows — trim is applied in this parser
    expect(transactions[0].orderId).toBe('9876543210');
  });
});

// ---------------------------------------------------------------------------
// Market order: empty Average Price is NOT an error
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – Market order with empty Average Price', () => {
  it('accepts empty Average Price without error', () => {
    const { transactions, errors } = parseFuturesOrder(
      [makeRow({ 'Average Price': '', Price: '' })],
      'test.csv'
    );
    expect(errors).toHaveLength(0);
    expect(transactions[0].price).toBe('');
  });

  it('stores empty price as empty string not null', () => {
    const { transactions } = parseFuturesOrder([makeRow({ 'Average Price': '' })], 'test.csv');
    expect(transactions[0].price).toBe('');
    expect(transactions[0].price).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Required field validation → errors
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – validation errors', () => {
  it('emits error for row with missing Order ID', () => {
    const { transactions, errors } = parseFuturesOrder([makeRow({ 'Order ID': '' })], 'test.csv');
    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('Order ID');
  });

  it('emits error for row with missing Date', () => {
    const { transactions, errors } = parseFuturesOrder([makeRow({ Date: '' })], 'test.csv');
    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('Date');
  });

  it('emits error for row with missing Direction', () => {
    const { transactions, errors } = parseFuturesOrder([makeRow({ Direction: '' })], 'test.csv');
    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('Direction');
  });

  it('includes row number (1-based) in error', () => {
    const { errors } = parseFuturesOrder([makeRow(), makeRow({ Direction: '' })], 'test.csv');
    expect(errors[0].row).toBe(2);
  });

  it('includes rawData in error for context', () => {
    const { errors } = parseFuturesOrder([makeRow({ Direction: '' })], 'test.csv');
    expect(errors[0].rawData).toContain('BTCUSDT');
  });
});

// ---------------------------------------------------------------------------
// Mixed valid/invalid rows
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – mixed rows', () => {
  it('processes valid rows and skips invalid ones', () => {
    const rows = [
      makeRow({ Direction: 'Open long' }),
      makeRow({ 'Order ID': '' }), // invalid
      makeRow({ Direction: 'Close long', 'Realized P/L': '7' }),
      makeRow({ Date: '' }), // invalid
      makeRow({ Direction: 'Open short' }),
    ];
    const { transactions, errors } = parseFuturesOrder(rows, 'mixed.csv');
    expect(transactions).toHaveLength(3);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[1].row).toBe(4);
  });

  it('returns empty arrays for empty input', () => {
    const { transactions, errors } = parseFuturesOrder([], 'empty.csv');
    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type-level: ParsedFuturesOrder shape
// ---------------------------------------------------------------------------

describe('parseFuturesOrder – ParsedFuturesOrder type', () => {
  it('returned transaction satisfies the ParsedFuturesOrder interface', () => {
    const { transactions } = parseFuturesOrder([makeRow()], 'test.csv');
    const tx: ParsedFuturesOrder = transactions[0];
    // Compile-time check — if interface fields are missing this would be a TS error
    expect(typeof tx.orderId).toBe('string');
    expect(typeof tx.tradedAt).toBe('string');
    expect(typeof tx.coin).toBe('string');
    expect(typeof tx.futures).toBe('string');
    expect(typeof tx.rawType).toBe('string');
    expect(typeof tx.orderSource).toBe('string');
    expect(typeof tx.transactionType).toBe('string');
    expect(typeof tx.price).toBe('string');
    expect(typeof tx.amount).toBe('string');
    expect(typeof tx.executed).toBe('string');
    expect(typeof tx.tradingVolume).toBe('string');
    expect(typeof tx.realizedPnl).toBe('string');
    expect(typeof tx.netProfits).toBe('string');
    expect(typeof tx.status).toBe('string');
    expect(typeof tx.sourceFile).toBe('string');
  });
});
