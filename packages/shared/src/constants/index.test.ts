import { describe, expect, it } from 'vitest';
import { TAX_CONSTANTS } from './index.js';

describe('TAX_CONSTANTS', () => {
  it('has correct Haltefrist days', () => {
    // Conservative interpretation: 366 days (Jan 1 buy → tax-free from Jan 2 next year)
    expect(TAX_CONSTANTS.HALTEFRIST_DAYS).toBe(366);
  });

  it('has correct spot Freigrenze', () => {
    expect(TAX_CONSTANTS.SPOT_FREIGRENZE_EUR).toBe('1000');
  });

  it('has correct earn Freigrenze', () => {
    expect(TAX_CONSTANTS.EARN_FREIGRENZE_EUR).toBe('256');
  });

  it('has correct Abgeltungssteuer rate', () => {
    expect(TAX_CONSTANTS.ABGELTUNGSSTEUER_RATE).toBe('0.26375');
  });

  it('includes bitget as exchange', () => {
    expect(TAX_CONSTANTS.EXCHANGES).toContain('bitget');
  });
});
