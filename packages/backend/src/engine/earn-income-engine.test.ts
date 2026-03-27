/**
 * Tests for the Earn Income Engine.
 *
 * Earn/staking income has dual tax treatment under German law:
 *   1. Taxable income under §22 Nr. 3 EStG at EUR value at Zufluss (receipt)
 *   2. Creates a new FIFO lot for the received coins for future Haltefrist tracking
 *
 * Note: The 256 EUR Freigrenze (EARN_FREIGRENZE_EUR) is NOT applied here.
 * It is applied at the orchestrator level per-year (cliff behavior: if annual
 * earn income <= 256 EUR, taxable = 0; if > 256, full amount is taxable).
 */
import { describe, expect, it } from 'vitest';
import { runEarnIncomeEngine } from './earn-income-engine.js';
import type { EngineTransaction } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeTx(overrides: Partial<EngineTransaction> = {}): EngineTransaction {
  idCounter += 1;
  return {
    id: idCounter,
    orderId: `ord-${idCounter}`,
    exchange: 'bitget',
    sourceType: 'earn',
    canonicalType: 'earn_interest',
    symbol: 'ETH',
    side: null,
    amount: '1',
    price: '0',
    fee: '0',
    totalValue: '0',
    tradedAt: '2024-03-15 10:00:00',
    taxYear: 2024,
    eurPrice: '3000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEarnIncomeEngine', () => {
  it('records income for earn_interest transaction', () => {
    const tx = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '3000',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.incomeRecords).toHaveLength(1);
    expect(result.incomeRecords[0].transactionId).toBe(tx.id);
    expect(result.incomeRecords[0].symbol).toBe('ETH');
    expect(result.incomeRecords[0].amount).toBe('1');
    // 1 * 3000 = 3000
    expect(result.incomeRecords[0].eurValueAtReceipt).toBe('3000');
    expect(result.incomeRecords[0].receivedAt).toBe(tx.tradedAt);
    expect(result.incomeRecords[0].taxYear).toBe(2024);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips earn_deposit (internal transfer, not income)', () => {
    const tx = makeTx({
      canonicalType: 'earn_deposit',
      symbol: 'BTC',
      amount: '0.5',
      eurPrice: '50000',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.incomeRecords).toHaveLength(0);
    expect(result.lotsCreated).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/earn deposit/);
  });

  it('creates FIFO lot for each earn transaction', () => {
    const tx = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '3000',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.lotsCreated).toHaveLength(1);
    const lot = result.lotsCreated[0];
    expect(lot.transactionId).toBe(tx.id);
    expect(lot.symbol).toBe('ETH');
    // cost basis = fair market value at receipt
    expect(lot.costPerUnitEur.toFixed()).toBe('3000');
    // earn transactions have no acquisition fee
    expect(lot.feeEur.toFixed()).toBe('0');
    expect(lot.acquiredAt).toBe(tx.tradedAt);
    expect(lot.taxYear).toBe(2024);
  });

  it('FIFO lot has correct cost basis', () => {
    const tx = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '2',
      eurPrice: '1500',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.lotsCreated).toHaveLength(1);
    const lot = result.lotsCreated[0];
    // originalAmount = 2
    expect(lot.originalAmount.toFixed()).toBe('2');
    // remainingAmount = 2 (not yet consumed)
    expect(lot.remainingAmount.toFixed()).toBe('2');
    // costPerUnitEur = eurPrice = 1500
    expect(lot.costPerUnitEur.toFixed()).toBe('1500');
    // costBasisEur = 2 * 1500 = 3000
    expect(lot.originalAmount.times(lot.costPerUnitEur).toFixed()).toBe('3000');
  });

  it('skips earn_withdrawal', () => {
    const tx = makeTx({
      canonicalType: 'earn_withdrawal',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '3000',
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.incomeRecords).toHaveLength(0);
    expect(result.lotsCreated).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].transactionId).toBe(tx.id);
    expect(result.skipped[0].reason).toMatch(/earn deposit\/withdrawal/);
  });

  it('skips non-earn transactions', () => {
    const buy = makeTx({
      canonicalType: 'buy',
      sourceType: 'spot_tx',
      symbol: 'BTC',
    });
    const sell = makeTx({
      canonicalType: 'sell',
      sourceType: 'spot_tx',
      symbol: 'ETH',
    });
    const futuresClose = makeTx({
      canonicalType: 'futures_close_long',
      sourceType: 'futures_tx',
      symbol: 'BTCUSDT',
    });

    const result = runEarnIncomeEngine([buy, sell, futuresClose]);

    expect(result.incomeRecords).toHaveLength(0);
    expect(result.lotsCreated).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
    for (const s of result.skipped) {
      expect(s.reason).toBeTruthy();
    }
  });

  it('processes multiple earn_interest transactions', () => {
    const earn1 = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '3000',
      taxYear: 2024,
    });
    const earn2 = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'BTC',
      amount: '0.1',
      eurPrice: '40000',
      taxYear: 2024,
    });
    const earn3 = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '0.5',
      eurPrice: '3100',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([earn1, earn2, earn3]);

    expect(result.incomeRecords).toHaveLength(3);
    expect(result.lotsCreated).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it('normalizes symbol from earn source type', () => {
    const tx = makeTx({
      canonicalType: 'earn_interest',
      sourceType: 'earn',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '3000',
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.incomeRecords[0].symbol).toBe('ETH');
    expect(result.lotsCreated[0].symbol).toBe('ETH');
  });

  it('handles zero eurPrice gracefully', () => {
    const tx = makeTx({
      canonicalType: 'earn_interest',
      symbol: 'ETH',
      amount: '1',
      eurPrice: '0',
      taxYear: 2024,
    });

    const result = runEarnIncomeEngine([tx]);

    expect(result.incomeRecords).toHaveLength(1);
    // 1 * 0 = 0
    expect(result.incomeRecords[0].eurValueAtReceipt).toBe('0');
    expect(result.lotsCreated).toHaveLength(1);
    expect(result.lotsCreated[0].costPerUnitEur.toFixed()).toBe('0');
  });
});
