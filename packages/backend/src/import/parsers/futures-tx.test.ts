import { describe, expect, it } from 'vitest';
import type { ParsedFuturesTx } from './futures-tx.js';
import { parseFuturesTx } from './futures-tx.js';

// ---------------------------------------------------------------------------
// Helpers: build raw CSV row objects matching the futures_tx header set
// Headers: Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    Order: '1258113040865390595',
    Date: '2024-06-15 12:30:00',
    Coin: 'USDT',
    Futures: 'POPCATUSDT',
    'Margin Mode': 'crossed',
    Type: 'open_long',
    Amount: '-10.5',
    Fee: '-0.0105',
    'Wallet balance': '489.49',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

describe('parseFuturesTx', () => {
  // --- Happy path: individual transaction types --------------------------

  it('parses open_long row correctly', () => {
    const rows = [makeRow({ Type: 'open_long', Amount: '-10.5', Fee: '-0.0105' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(1);

    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('open_long');
    expect(tx.orderId).toBe('1258113040865390595');
    expect(tx.tradedAt).toBe('2024-06-15 12:30:00');
    expect(tx.coin).toBe('USDT');
    expect(tx.futures).toBe('POPCATUSDT');
    expect(tx.marginMode).toBe('crossed');
    expect(tx.amount).toBe('-10.5');
    expect(tx.fee).toBe('-0.0105');
    expect(tx.walletBalance).toBe('489.49');
    expect(tx.sourceFile).toBe('test.csv');
  });

  it('parses close_short row with signed amount', () => {
    const rows = [makeRow({ Type: 'close_short', Amount: '15.75', Fee: '-0.015' })];
    const { transactions, errors } = parseFuturesTx(rows, 'futures.csv');

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(1);

    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('close_short');
    expect(tx.amount).toBe('15.75');
    expect(tx.fee).toBe('-0.015');
  });

  it('parses open_short row', () => {
    const rows = [makeRow({ Type: 'open_short', Futures: 'BTCUSDT', Coin: 'USDT' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('open_short');
    expect(tx.futures).toBe('BTCUSDT');
  });

  it('parses close_long row', () => {
    const rows = [makeRow({ Type: 'close_long' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('close_long');
  });

  it('preserves burst_close_short rawType exactly', () => {
    const rows = [makeRow({ Type: 'burst_close_short', Amount: '8.0' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('burst_close_short');
  });

  it('parses contract_main_settle_fee (funding rate)', () => {
    const rows = [makeRow({ Type: 'contract_main_settle_fee', Amount: '-0.32', Fee: '0' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('contract_main_settle_fee');
    expect(tx.amount).toBe('-0.32');
  });

  it('parses trans_from_exchange (transfer from spot)', () => {
    const rows = [makeRow({ Type: 'trans_from_exchange', Amount: '100', Fee: '0' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('trans_from_exchange');
  });

  it('parses transfer_from_future_copytrade', () => {
    const rows = [makeRow({ Type: 'transfer_from_future_copytrade', Amount: '50' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.rawType).toBe('transfer_from_future_copytrade');
  });

  it('preserves Bitget typo: risk_captital_user_transfer (not corrected)', () => {
    // The raw Bitget CSV has "captital" (two t's) — must NOT be corrected
    const rows = [makeRow({ Type: 'risk_captital_user_transfer', Amount: '25' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    // Verify the EXACT typo is preserved — correcting it would break production mapping
    expect(tx.rawType).toBe('risk_captital_user_transfer');
    expect(tx.rawType).not.toBe('risk_capital_user_transfer');
  });

  // --- Tab-stripped Order ID -------------------------------------------------

  it('strips leading tab from Order column', () => {
    const rows = [makeRow({ Order: '\t1258113040865390595' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    // parseFuturesTx receives pre-parsed rows; tab stripping is csv-parse's job.
    // The parser should strip tabs itself as a safety measure.
    expect(errors).toHaveLength(0);
    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.orderId).toBe('1258113040865390595');
    expect(tx.orderId).not.toContain('\t');
  });

  // --- Error cases -----------------------------------------------------------

  it('returns error for row with missing Order', () => {
    const rows = [makeRow({ Order: '' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('order');
    expect(errors[0].row).toBe(1);
  });

  it('returns error for row with missing Date', () => {
    const rows = [makeRow({ Date: '' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('date');
    expect(errors[0].row).toBe(1);
  });

  it('returns error for row with empty Type', () => {
    const rows = [makeRow({ Type: '' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('type');
    expect(errors[0].row).toBe(1);
  });

  it('returns error for row with missing Amount', () => {
    const rows = [makeRow({ Amount: '' })];
    const { transactions, errors } = parseFuturesTx(rows, 'test.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('amount');
    expect(errors[0].row).toBe(1);
  });

  // --- Mixed valid/invalid rows ---------------------------------------------

  it('splits mixed rows into transactions and errors correctly', () => {
    const rows = [
      makeRow({ Type: 'open_long' }), // valid — row 1
      makeRow({ Order: '' }), // invalid — row 2
      makeRow({ Type: 'close_short' }), // valid — row 3
      makeRow({ Date: '' }), // invalid — row 4
      makeRow({ Type: 'burst_close_short' }), // valid — row 5
    ];
    const { transactions, errors } = parseFuturesTx(rows, 'mixed.csv');

    expect(transactions).toHaveLength(3);
    expect(errors).toHaveLength(2);

    // Row numbers must reflect original position (1-indexed)
    expect(errors[0].row).toBe(2);
    expect(errors[1].row).toBe(4);

    // Verify valid transactions have correct types
    expect(transactions[0].rawType).toBe('open_long');
    expect(transactions[1].rawType).toBe('close_short');
    expect(transactions[2].rawType).toBe('burst_close_short');
  });

  // --- All 9 raw type strings from research document -----------------------

  it('accepts all 9 known futures transaction type strings without errors', () => {
    const allTypes = [
      'open_long',
      'open_short',
      'close_long',
      'close_short',
      'burst_close_short',
      'contract_main_settle_fee',
      'trans_from_exchange',
      'transfer_from_future_copytrade',
      'risk_captital_user_transfer', // Bitget typo intentional
    ];

    const rows = allTypes.map((type) => makeRow({ Type: type }));
    const { transactions, errors } = parseFuturesTx(rows, 'all-types.csv');

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(9);

    // Verify each rawType is preserved exactly
    allTypes.forEach((type, idx) => {
      expect(transactions[idx].rawType).toBe(type);
    });
  });

  // --- Both key columns captured -------------------------------------------

  it('captures both Futures (symbol) and Coin (settlement) columns independently', () => {
    const rows = [makeRow({ Futures: 'POPCATUSDT', Coin: 'USDT' })];
    const { transactions } = parseFuturesTx(rows, 'test.csv');

    const tx = transactions[0] as ParsedFuturesTx;
    expect(tx.futures).toBe('POPCATUSDT');
    expect(tx.coin).toBe('USDT');
    // These are distinct fields — not the same value
  });

  // --- sourceFile propagation ----------------------------------------------

  it('attaches sourceFile to every parsed transaction', () => {
    const rows = [makeRow({ Type: 'open_long' }), makeRow({ Type: 'close_short' })];
    const { transactions } = parseFuturesTx(rows, 'my-futures.csv');

    for (const tx of transactions) {
      expect(tx.sourceFile).toBe('my-futures.csv');
    }
  });

  // --- Error rawData preservation -------------------------------------------

  it('includes rawData in error for debugging', () => {
    const rows = [makeRow({ Order: '' })];
    const { errors } = parseFuturesTx(rows, 'test.csv');

    expect(errors[0].rawData).toBeDefined();
    expect(typeof errors[0].rawData).toBe('string');
  });
});
