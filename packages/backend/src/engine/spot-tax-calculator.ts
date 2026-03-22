/**
 * Spot Tax Calculator — §23 EStG (private sales, Veräußerungsgeschäfte).
 *
 * Takes FIFO consumption records and produces per-year tax aggregations applying:
 * - Haltefrist: gains from lots held >= 366 days are tax-free (§23 Abs. 1 Nr. 2 EStG)
 * - Freigrenze cliff: net gain <= 1000 EUR → taxableAmountEur = 0 (complete exemption,
 *   not a deduction — if exceeded, the FULL net gain is taxable)
 * - Fee deduction: fees are Werbungskosten, reduce the gain
 *
 * Note: The Freigrenze is applied to the NET gain (gains minus losses) for the year.
 * Tax-free (Haltefrist-met) gains are excluded from the net gain calculation entirely.
 */
import { TAX_CONSTANTS, fromDecimal, toDecimal, ZERO } from '@cryptax/shared';
import type { ConsumptionRecord, SpotTaxResult } from './types.js';

// ---------------------------------------------------------------------------
// calculateSpotTax
// ---------------------------------------------------------------------------

/**
 * Pure function. Takes consumption records from the FIFO engine and returns
 * one SpotTaxResult per tax year, sorted by taxYear ASC.
 *
 * @param consumptions - ConsumptionRecord array from runFifoEngine
 * @returns SpotTaxResult array, one entry per year, sorted ascending
 */
export function calculateSpotTax(consumptions: ConsumptionRecord[]): SpotTaxResult[] {
  if (consumptions.length === 0) {
    return [];
  }

  const freigrenze = toDecimal(TAX_CONSTANTS.SPOT_FREIGRENZE_EUR);

  // Group consumptions by taxYear
  const byYear = new Map<number, ConsumptionRecord[]>();
  for (const c of consumptions) {
    let group = byYear.get(c.taxYear);
    if (!group) {
      group = [];
      byYear.set(c.taxYear, group);
    }
    group.push(c);
  }

  const results: SpotTaxResult[] = [];

  for (const [taxYear, records] of byYear) {
    let totalGains = ZERO; // taxable gains (haltefristMet=false, gainLoss > 0)
    let totalLosses = ZERO; // taxable losses (haltefristMet=false, gainLoss < 0) — stored negative
    let taxFreeGain = ZERO; // tax-exempt gains (haltefristMet=true, gainLoss > 0)
    let totalFees = ZERO; // all fees for the year (informational)
    const sellIds = new Set<number>();

    for (const record of records) {
      totalFees = totalFees.plus(record.feeEur);
      sellIds.add(record.sellTransactionId);

      if (record.haltefristMet) {
        // Tax-free: gains go to taxFreeGain, losses are irrelevant for taxation
        if (record.gainLossEur.greaterThan(ZERO)) {
          taxFreeGain = taxFreeGain.plus(record.gainLossEur);
        }
        // Haltefrist-met losses are not counted (no tax benefit, no tax liability)
      } else {
        // Taxable: separate gains and losses for netting
        if (record.gainLossEur.greaterThan(ZERO)) {
          totalGains = totalGains.plus(record.gainLossEur);
        } else if (record.gainLossEur.lessThan(ZERO)) {
          totalLosses = totalLosses.plus(record.gainLossEur);
        }
      }
    }

    // Net gain = taxable gains + taxable losses (losses are negative, so this subtracts)
    const netGain = totalGains.plus(totalLosses);

    // Apply Freigrenze cliff: <= 1000 EUR → 0, > 1000 EUR → full netGain
    let taxableAmount = ZERO;
    if (netGain.greaterThan(freigrenze)) {
      taxableAmount = netGain;
    }
    // else: taxableAmount stays 0 (net gain is 0, negative, or within Freigrenze)

    results.push({
      taxYear,
      totalGainsEur: fromDecimal(totalGains),
      totalLossesEur: fromDecimal(totalLosses),
      netGainEur: fromDecimal(netGain),
      taxFreeGainEur: fromDecimal(taxFreeGain),
      taxableAmountEur: fromDecimal(taxableAmount),
      totalFeesEur: fromDecimal(totalFees),
      tradeCount: sellIds.size,
    });
  }

  // Sort by taxYear ascending
  results.sort((a, b) => a.taxYear - b.taxYear);

  return results;
}
