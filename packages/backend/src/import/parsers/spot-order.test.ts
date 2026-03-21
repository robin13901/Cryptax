import { describe, expect, it } from 'vitest';
import type { ImportFileError } from '@cryptax/shared';
import { parseSpotOrder } from './spot-order.js';
import type { ParsedSpotOrder } from './spot-order.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid spot order row (Buy, BTC/EUR) */
function makeBuyRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    Date: '2024-11-15 10:23:44',
    Type: 'Limit',
    'Order Id': '1258113040865390595',
    'Trading pair': 'BTCEUR',
    'Base Asset': 'BTC',
    'Quote Asset': 'EUR',
    Direction: 'Buy',
    Price: '85000',
    'Order amount': '0.001',
    Executed: '0.001',
    'Average Price': '84950.50',
    'Trading volume': '84.9505',
    Status: 'Filled',
    ...overrides,
  };
}

/** Minimal valid spot order row (Sell, ETH/EUR) */
function makeSellRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    Date: '2024-11-20 14:05:00',
    Type: 'Market',
    'Order Id': '9876543210987654321',
    'Trading pair': 'ETHEUR',
    'Base Asset': 'ETH',
    'Quote Asset': 'EUR',
    Direction: 'Sell',
    Price: '',
    'Order amount': '0.5',
    Executed: '0.5',
    'Average Price': '3200.00',
    'Trading volume': '1600.00',
    Status: 'Filled',
    ...overrides,
  };
}

/** Row with tab-prefixed Order Id (as it arrives from csv-parse when trim is disabled) */
function makeTabPrefixedRow(): Record<string, string> {
  return {
    Date: '2024-12-01 09:00:00',
    Type: 'Limit',
    'Order Id': '\t1111222233334444555',
    'Trading pair': 'BTCEUR',
    'Base Asset': 'BTC',
    'Quote Asset': 'EUR',
    Direction: 'Buy',
    Price: '90000',
    'Order amount': '0.002',
    Executed: '0.001',
    'Average Price': '89999.00',
    'Trading volume': '179.998',
    Status: 'Partially Filled',
    ...{},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSpotOrder', () => {
  describe('successful parsing', () => {
    it('parses a Buy limit order with correct field mapping', () => {
      const { transactions, errors } = parseSpotOrder([makeBuyRow()], 'test.csv');

      expect(errors).toHaveLength(0);
      expect(transactions).toHaveLength(1);

      const tx = transactions[0];
      expect(tx.orderId).toBe('1258113040865390595');
      expect(tx.tradedAt).toBe('2024-11-15 10:23:44');
      expect(tx.symbol).toBe('BTC/EUR');
      expect(tx.baseAsset).toBe('BTC');
      expect(tx.quoteAsset).toBe('EUR');
      expect(tx.rawType).toBe('Buy');
      expect(tx.orderType).toBe('Limit');
      expect(tx.price).toBe('84950.50');
      expect(tx.amount).toBe('0.001');
      expect(tx.executed).toBe('0.001');
      expect(tx.tradingVolume).toBe('84.9505');
      expect(tx.status).toBe('Filled');
      expect(tx.sourceFile).toBe('test.csv');
    });

    it('parses a Sell market order correctly', () => {
      const { transactions, errors } = parseSpotOrder([makeSellRow()], 'sell-test.csv');

      expect(errors).toHaveLength(0);
      expect(transactions).toHaveLength(1);

      const tx = transactions[0];
      expect(tx.rawType).toBe('Sell');
      expect(tx.orderType).toBe('Market');
      expect(tx.symbol).toBe('ETH/EUR');
      expect(tx.price).toBe('3200.00');
    });

    it('derives symbol from Base Asset + "/" + Quote Asset (not Trading pair)', () => {
      const { transactions } = parseSpotOrder(
        [makeBuyRow({ 'Base Asset': 'ETH', 'Quote Asset': 'EUR', 'Trading pair': 'ETHEUR' })],
        'test.csv',
      );

      expect(transactions[0].symbol).toBe('ETH/EUR');
    });

    it('uses Average Price, not the Price column', () => {
      const row = makeBuyRow({ Price: '99999', 'Average Price': '84950.50' });
      const { transactions } = parseSpotOrder([row], 'test.csv');

      expect(transactions[0].price).toBe('84950.50');
      expect(transactions[0].price).not.toBe('99999');
    });

    it('maps Direction to rawType (not the Type column)', () => {
      // Type column is 'Limit', Direction is 'Buy' — rawType must be Direction
      const row = makeBuyRow({ Type: 'Limit', Direction: 'Buy' });
      const { transactions } = parseSpotOrder([row], 'test.csv');

      expect(transactions[0].rawType).toBe('Buy');
      expect(transactions[0].orderType).toBe('Limit');
    });

    it('captures trading volume (total value in quote asset)', () => {
      const { transactions } = parseSpotOrder([makeBuyRow()], 'test.csv');

      expect(transactions[0].tradingVolume).toBe('84.9505');
    });

    it('captures a partially filled order with differing executed and amount', () => {
      const row = makeBuyRow({
        'Order amount': '0.01',
        Executed: '0.005',
        Status: 'Partially Filled',
      });
      const { transactions } = parseSpotOrder([row], 'test.csv');

      const tx = transactions[0];
      expect(tx.amount).toBe('0.01');
      expect(tx.executed).toBe('0.005');
      expect(tx.status).toBe('Partially Filled');
    });

    it('strips leading tab character from Order Id', () => {
      const { transactions, errors } = parseSpotOrder([makeTabPrefixedRow()], 'test.csv');

      expect(errors).toHaveLength(0);
      expect(transactions[0].orderId).toBe('1111222233334444555');
      expect(transactions[0].orderId).not.toMatch(/^\t/);
    });

    it('stores the source filename on each parsed row', () => {
      const { transactions } = parseSpotOrder([makeBuyRow()], 'spot-order-history.csv');

      expect(transactions[0].sourceFile).toBe('spot-order-history.csv');
    });

    it('parses multiple rows and returns them in order', () => {
      const rows = [makeBuyRow(), makeSellRow()];
      const { transactions, errors } = parseSpotOrder(rows, 'multi.csv');

      expect(errors).toHaveLength(0);
      expect(transactions).toHaveLength(2);
      expect(transactions[0].rawType).toBe('Buy');
      expect(transactions[1].rawType).toBe('Sell');
    });

    it('returns empty arrays when no rows are provided', () => {
      const { transactions, errors } = parseSpotOrder([], 'empty.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('returns an error (not a transaction) when Order Id is missing', () => {
      const row = makeBuyRow({ 'Order Id': '' });
      const { transactions, errors } = parseSpotOrder([row], 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('Order Id');
      expect(errors[0].row).toBe(1);
    });

    it('returns an error when Date is missing', () => {
      const row = makeBuyRow({ Date: '' });
      const { transactions, errors } = parseSpotOrder([row], 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('Date');
    });

    it('returns an error when Direction is missing', () => {
      const row = makeBuyRow({ Direction: '' });
      const { transactions, errors } = parseSpotOrder([row], 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('Direction');
    });

    it('returns an error when Average Price is missing', () => {
      const row = makeBuyRow({ 'Average Price': '' });
      const { transactions, errors } = parseSpotOrder([row], 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('Average Price');
    });

    it('returns an error when Order amount is missing', () => {
      const row = makeBuyRow({ 'Order amount': '' });
      const { transactions, errors } = parseSpotOrder([row], 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('Order amount');
    });

    it('error row number is 1-based matching the data row index', () => {
      // Row 0 = valid, row 1 = invalid (0-indexed). Error row should be 2 (1-based).
      const rows = [makeBuyRow(), makeBuyRow({ 'Order Id': '' })];
      const { transactions, errors } = parseSpotOrder(rows, 'test.csv');

      expect(transactions).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].row).toBe(2);
    });

    it('includes raw data in the error for debugging', () => {
      const row = makeBuyRow({ 'Order Id': '' });
      const { errors } = parseSpotOrder([row], 'test.csv');

      expect(errors[0].rawData).toBeDefined();
    });

    it('collects errors for multiple bad rows without stopping', () => {
      const rows = [
        makeBuyRow({ 'Order Id': '' }),
        makeBuyRow({ Date: '' }),
        makeBuyRow({ Direction: '' }),
      ];
      const { transactions, errors } = parseSpotOrder(rows, 'test.csv');

      expect(transactions).toHaveLength(0);
      expect(errors).toHaveLength(3);
    });

    it('mixes valid and invalid rows in the same batch', () => {
      const rows = [
        makeBuyRow(),
        makeBuyRow({ 'Order Id': '' }),
        makeSellRow(),
      ];
      const { transactions, errors } = parseSpotOrder(rows, 'test.csv');

      expect(transactions).toHaveLength(2);
      expect(errors).toHaveLength(1);
    });
  });

  describe('type safety', () => {
    it('returns typed ParsedSpotOrder objects with all required fields', () => {
      const { transactions } = parseSpotOrder([makeBuyRow()], 'test.csv');
      const tx: ParsedSpotOrder = transactions[0];

      // Type-level check — all fields must be accessible
      expect(typeof tx.orderId).toBe('string');
      expect(typeof tx.tradedAt).toBe('string');
      expect(typeof tx.symbol).toBe('string');
      expect(typeof tx.baseAsset).toBe('string');
      expect(typeof tx.quoteAsset).toBe('string');
      expect(typeof tx.rawType).toBe('string');
      expect(typeof tx.orderType).toBe('string');
      expect(typeof tx.price).toBe('string');
      expect(typeof tx.amount).toBe('string');
      expect(typeof tx.executed).toBe('string');
      expect(typeof tx.tradingVolume).toBe('string');
      expect(typeof tx.status).toBe('string');
      expect(typeof tx.sourceFile).toBe('string');
    });

    it('returns typed ImportFileError objects with required fields', () => {
      const { errors } = parseSpotOrder([makeBuyRow({ 'Order Id': '' })], 'test.csv');
      const err: ImportFileError = errors[0];

      expect(typeof err.row).toBe('number');
      expect(typeof err.field).toBe('string');
      expect(typeof err.message).toBe('string');
    });
  });
});
