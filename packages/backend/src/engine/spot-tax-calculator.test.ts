/**
 * Tests for the Spot Tax Calculator.
 *
 * The spot tax calculator applies §23 EStG rules to FIFO consumption records:
 * - Haltefrist: gains from lots held >= 366 days are tax-free
 * - Freigrenze: net gain <= 1000 EUR → taxableAmountEur = 0 (cliff, not deduction)
 * - Fees reduce the gain (Werbungskosten)
 * - Results aggregated per tax year
 */
import { describe, expect, it } from 'vitest';
import { calculateSpotTax } from './spot-tax-calculator.js';
import type { ConsumptionRecord } from './types.js';
import { toDecimal } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let lotIndex = 0;
let sellId = 100;

function makeConsumption(overrides: Partial<ConsumptionRecord> = {}): ConsumptionRecord {
  lotIndex += 1;
  sellId += 1;
  return {
    lotIndex,
    sellTransactionId: sellId,
    amountConsumed: toDecimal('1'),
    costBasisEur: toDecimal('800'),
    proceedsEur: toDecimal('1000'),
    gainLossEur: toDecimal('200'),
    feeEur: toDecimal('5'),
    heldDays: 100,
    haltefristMet: false,
    taxYear: 2024,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateSpotTax', () => {
  it('handles empty consumption list', () => {
    const result = calculateSpotTax([]);
    expect(result).toHaveLength(0);
  });

  it('aggregates gains and losses for a single year', () => {
    const consumptions = [
      makeConsumption({ gainLossEur: toDecimal('500'), feeEur: toDecimal('10'), taxYear: 2024 }),
      makeConsumption({ gainLossEur: toDecimal('300'), feeEur: toDecimal('5'), taxYear: 2024 }),
      makeConsumption({ gainLossEur: toDecimal('-100'), feeEur: toDecimal('3'), taxYear: 2024 }),
    ];

    const result = calculateSpotTax(consumptions);

    expect(result).toHaveLength(1);
    const year = result[0];
    expect(year.taxYear).toBe(2024);
    expect(year.totalGainsEur).toBe('800'); // 500 + 300
    expect(year.totalLossesEur).toBe('-100'); // -100
    expect(year.netGainEur).toBe('700'); // 800 - 100
    expect(year.totalFeesEur).toBe('18'); // 10 + 5 + 3
  });

  it('separates tax-free gains (Haltefrist met)', () => {
    const taxFree = makeConsumption({
      gainLossEur: toDecimal('5000'),
      feeEur: toDecimal('20'),
      haltefristMet: true,
      taxYear: 2024,
    });
    const taxable = makeConsumption({
      gainLossEur: toDecimal('200'),
      feeEur: toDecimal('5'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([taxFree, taxable]);

    expect(result).toHaveLength(1);
    const year = result[0];
    expect(year.taxFreeGainEur).toBe('5000');
    expect(year.totalGainsEur).toBe('200'); // only taxable gains
    expect(year.totalLossesEur).toBe('0');
    expect(year.netGainEur).toBe('200');
    // Net gain 200 <= 1000 → Freigrenze applies
    expect(year.taxableAmountEur).toBe('0');
  });

  it('Haltefrist boundary: 365 days is NOT tax-free', () => {
    const consumption = makeConsumption({
      gainLossEur: toDecimal('2000'),
      feeEur: toDecimal('0'),
      heldDays: 365,
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([consumption]);

    expect(result).toHaveLength(1);
    const year = result[0];
    expect(year.taxFreeGainEur).toBe('0');
    expect(year.totalGainsEur).toBe('2000');
    expect(year.taxableAmountEur).toBe('2000'); // > 1000, full amount taxable
  });

  it('Haltefrist boundary: 366 days IS tax-free', () => {
    const consumption = makeConsumption({
      gainLossEur: toDecimal('2000'),
      feeEur: toDecimal('0'),
      heldDays: 366,
      haltefristMet: true,
      taxYear: 2024,
    });

    const result = calculateSpotTax([consumption]);

    expect(result).toHaveLength(1);
    const year = result[0];
    expect(year.taxFreeGainEur).toBe('2000');
    expect(year.totalGainsEur).toBe('0'); // no taxable gains
    expect(year.taxableAmountEur).toBe('0'); // net 0 → Freigrenze
  });

  it('Freigrenze cliff: 999.99 EUR net gain is not taxable', () => {
    const consumption = makeConsumption({
      gainLossEur: toDecimal('999.99'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([consumption]);

    expect(result[0].netGainEur).toBe('999.99');
    expect(result[0].taxableAmountEur).toBe('0');
  });

  it('Freigrenze cliff: 1000.00 EUR net gain is not taxable', () => {
    const consumption = makeConsumption({
      gainLossEur: toDecimal('1000'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([consumption]);

    expect(result[0].netGainEur).toBe('1000');
    expect(result[0].taxableAmountEur).toBe('0');
  });

  it('Freigrenze cliff: 1000.01 EUR net gain is FULLY taxable', () => {
    const consumption = makeConsumption({
      gainLossEur: toDecimal('1000.01'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([consumption]);

    expect(result[0].netGainEur).toBe('1000.01');
    // Entire amount is taxable, NOT just the 0.01 above the threshold
    expect(result[0].taxableAmountEur).toBe('1000.01');
  });

  it('losses reduce net gain below Freigrenze', () => {
    const gain = makeConsumption({
      gainLossEur: toDecimal('1200'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });
    const loss = makeConsumption({
      gainLossEur: toDecimal('-300'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([gain, loss]);

    expect(result[0].netGainEur).toBe('900');
    expect(result[0].taxableAmountEur).toBe('0'); // 900 <= 1000
  });

  it('losses reduce net gain but still above Freigrenze', () => {
    const gain = makeConsumption({
      gainLossEur: toDecimal('1500'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });
    const loss = makeConsumption({
      gainLossEur: toDecimal('-200'),
      feeEur: toDecimal('0'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([gain, loss]);

    expect(result[0].netGainEur).toBe('1300');
    expect(result[0].taxableAmountEur).toBe('1300'); // full amount
  });

  it('handles multiple years', () => {
    const consumption2024 = makeConsumption({
      gainLossEur: toDecimal('500'),
      haltefristMet: false,
      taxYear: 2024,
    });
    const consumption2025 = makeConsumption({
      gainLossEur: toDecimal('1200'),
      haltefristMet: false,
      taxYear: 2025,
    });

    const result = calculateSpotTax([consumption2024, consumption2025]);

    expect(result).toHaveLength(2);
    expect(result[0].taxYear).toBe(2024);
    expect(result[1].taxYear).toBe(2025);
    expect(result[0].taxableAmountEur).toBe('0'); // 500 <= 1000
    expect(result[1].taxableAmountEur).toBe('1200'); // > 1000, full amount
  });

  it('counts trades correctly (unique sellTransactionIds)', () => {
    // 3 sell transactions, but one sell consumed 2 lots → 4 consumption records
    const sell1Lot1 = makeConsumption({ sellTransactionId: 1001, taxYear: 2024 });
    const sell1Lot2 = makeConsumption({ sellTransactionId: 1001, taxYear: 2024 });
    const sell2Lot1 = makeConsumption({ sellTransactionId: 1002, taxYear: 2024 });
    const sell3Lot1 = makeConsumption({ sellTransactionId: 1003, taxYear: 2024 });

    const result = calculateSpotTax([sell1Lot1, sell1Lot2, sell2Lot1, sell3Lot1]);

    expect(result[0].tradeCount).toBe(3); // 3 unique sell transaction IDs
  });

  it('negative net gain (net loss) is not taxable', () => {
    const loss1 = makeConsumption({
      gainLossEur: toDecimal('-500'),
      haltefristMet: false,
      taxYear: 2024,
    });
    const loss2 = makeConsumption({
      gainLossEur: toDecimal('-300'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([loss1, loss2]);

    expect(result[0].netGainEur).toBe('-800');
    expect(result[0].taxableAmountEur).toBe('0'); // net loss → no tax
  });

  it('tax-free gains do not contribute to taxableAmountEur even when large', () => {
    const taxFree = makeConsumption({
      gainLossEur: toDecimal('50000'),
      haltefristMet: true,
      taxYear: 2024,
    });
    const smallTaxable = makeConsumption({
      gainLossEur: toDecimal('500'),
      haltefristMet: false,
      taxYear: 2024,
    });

    const result = calculateSpotTax([taxFree, smallTaxable]);

    expect(result[0].taxFreeGainEur).toBe('50000');
    expect(result[0].totalGainsEur).toBe('500');
    expect(result[0].netGainEur).toBe('500');
    expect(result[0].taxableAmountEur).toBe('0'); // 500 <= 1000
  });
});
