import { describe, expect, it } from 'vitest';
import { parseEarn } from './earn.js';
import type { ParsedEarn } from './earn.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Reference: '123456789',
    'Start time': '2024-03-15 10:30:00',
    Coin: 'ETH',
    Type: 'Staking',
    'Interest coin': 'ETH',
    Amount: '0.5',
    'Handling fee': '0',
    Status: 'Staked',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseEarn
// ---------------------------------------------------------------------------

describe('parseEarn', () => {
  // ---- Happy path: single valid row ----------------------------------------

  it('maps all fields from a valid staking row', () => {
    const rows = [makeRow()];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(1);

    const tx: ParsedEarn = transactions[0];
    expect(tx.reference).toBe('123456789');
    expect(tx.startTime).toBe('2024-03-15 10:30:00');
    expect(tx.coin).toBe('ETH');
    expect(tx.rawType).toBe('Staking');
    expect(tx.interestCoin).toBe('ETH');
    expect(tx.amount).toBe('0.5');
    expect(tx.handlingFee).toBe('0');
    expect(tx.status).toBe('Staked');
    expect(tx.sourceFile).toBe('earn.csv');
  });

  // ---- Reference has no tab prefix -----------------------------------------

  it('captures reference as clean numeric string (no tab stripping needed)', () => {
    const rows = [makeRow({ Reference: '987654321' })];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(errors).toHaveLength(0);
    expect(transactions[0].reference).toBe('987654321');
    // Confirm there is no leading tab in the reference
    expect(transactions[0].reference.startsWith('\t')).toBe(false);
  });

  it('still works if caller pre-trimmed reference (no double-trim side effects)', () => {
    const rows = [makeRow({ Reference: '   111222333   ' })];
    // csv-parse would normally trim this; we test the parser handles it gracefully
    const { transactions } = parseEarn(rows, 'earn.csv');
    // The parser should preserve what it received (trimming is csv-parse's job)
    expect(transactions[0].reference).toBe('111222333');
  });

  // ---- Interest coin differs from Coin -------------------------------------

  it('captures interest coin separately when it differs from staked coin', () => {
    const rows = [makeRow({ Coin: 'BTC', 'Interest coin': 'USDT' })];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(errors).toHaveLength(0);
    const tx = transactions[0];
    expect(tx.coin).toBe('BTC');
    expect(tx.interestCoin).toBe('USDT');
  });

  // ---- Amount is positive --------------------------------------------------

  it('preserves positive amount without modification', () => {
    const rows = [makeRow({ Amount: '1.25' })];
    const { transactions } = parseEarn(rows, 'earn.csv');

    expect(transactions[0].amount).toBe('1.25');
  });

  // ---- Handling fee captured -----------------------------------------------

  it('captures handling fee as string "0" when zero', () => {
    const rows = [makeRow({ 'Handling fee': '0' })];
    const { transactions } = parseEarn(rows, 'earn.csv');

    expect(transactions[0].handlingFee).toBe('0');
  });

  it('captures non-zero handling fee', () => {
    const rows = [makeRow({ 'Handling fee': '0.001' })];
    const { transactions } = parseEarn(rows, 'earn.csv');

    expect(transactions[0].handlingFee).toBe('0.001');
  });

  // ---- Status preserved ----------------------------------------------------

  it('preserves status field "Staked"', () => {
    const rows = [makeRow({ Status: 'Staked' })];
    const { transactions } = parseEarn(rows, 'earn.csv');

    expect(transactions[0].status).toBe('Staked');
  });

  // ---- Multiple valid rows --------------------------------------------------

  it('parses multiple valid rows and returns all as transactions', () => {
    const rows = [
      makeRow({ Reference: '1001', Amount: '0.1' }),
      makeRow({ Reference: '1002', Amount: '0.2' }),
      makeRow({ Reference: '1003', Amount: '0.3' }),
    ];
    const { transactions, errors } = parseEarn(rows, 'multi.csv');

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(3);
    expect(transactions[0].reference).toBe('1001');
    expect(transactions[1].reference).toBe('1002');
    expect(transactions[2].reference).toBe('1003');
  });

  // ---- Error: missing Reference --------------------------------------------

  it('produces an error for a row with missing Reference', () => {
    const rows = [makeRow({ Reference: '' })];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].field).toBe('reference');
  });

  // ---- Error: missing Start time -------------------------------------------

  it('produces an error for a row with missing Start time', () => {
    const rows = [makeRow({ 'Start time': '' })];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].field).toBe('start time');
  });

  // ---- Error: missing Amount -----------------------------------------------

  it('produces an error for a row with missing Amount', () => {
    const rows = [makeRow({ Amount: '' })];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].field).toBe('amount');
  });

  // ---- Mixed valid and invalid rows ----------------------------------------

  it('collects errors without stopping on valid rows', () => {
    const rows = [
      makeRow({ Reference: '9001' }),    // valid
      makeRow({ Reference: '' }),         // invalid
      makeRow({ Reference: '9003' }),    // valid
    ];
    const { transactions, errors } = parseEarn(rows, 'mixed.csv');

    expect(transactions).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
  });

  // ---- sourceFile attached -------------------------------------------------

  it('attaches sourceFile to every transaction', () => {
    const rows = [makeRow(), makeRow({ Reference: '555' })];
    const { transactions } = parseEarn(rows, 'my-earn-file.csv');

    expect(transactions[0].sourceFile).toBe('my-earn-file.csv');
    expect(transactions[1].sourceFile).toBe('my-earn-file.csv');
  });

  // ---- Empty input ---------------------------------------------------------

  it('returns empty arrays for empty input', () => {
    const { transactions, errors } = parseEarn([], 'earn.csv');
    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  // ---- Column key normalisation (lowercase) --------------------------------

  it('handles lowercase column keys from csv-parse normalisation', () => {
    // Simulates csv-parse output with lowercase keys (robustness test)
    const rows = [
      {
        reference: '777888999',
        'start time': '2024-06-01 08:00:00',
        coin: 'SOL',
        type: 'Staking',
        'interest coin': 'SOL',
        amount: '10',
        'handling fee': '0',
        status: 'Staked',
      },
    ];
    const { transactions, errors } = parseEarn(rows, 'earn.csv');
    expect(errors).toHaveLength(0);
    expect(transactions[0].reference).toBe('777888999');
    expect(transactions[0].coin).toBe('SOL');
    expect(transactions[0].interestCoin).toBe('SOL');
  });
});
