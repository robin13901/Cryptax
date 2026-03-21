import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  Decimal,
  fromDecimal,
  isNegative,
  isZero,
  multiplyMoney,
  subtractMoney,
  toDecimal,
  ZERO,
} from './money.js';

describe('toDecimal', () => {
  it('parses integer strings', () => {
    expect(toDecimal('100').toString()).toBe('100');
  });

  it('parses decimal strings', () => {
    // Use fromDecimal to avoid exponential notation in toString()
    expect(fromDecimal(toDecimal('0.00000001'))).toBe('0.00000001');
  });

  it('parses negative values', () => {
    expect(toDecimal('-42.5').toString()).toBe('-42.5');
  });

  it('returns zero for null', () => {
    expect(toDecimal(null).isZero()).toBe(true);
  });

  it('returns zero for undefined', () => {
    expect(toDecimal(undefined).isZero()).toBe(true);
  });

  it('returns zero for empty string', () => {
    expect(toDecimal('').isZero()).toBe(true);
  });

  it('parses number input', () => {
    expect(toDecimal(42).toString()).toBe('42');
  });
});

describe('fromDecimal', () => {
  it('serializes without scientific notation', () => {
    const val = new Decimal('0.00000001');
    expect(fromDecimal(val)).toBe('0.00000001');
    expect(fromDecimal(val)).not.toContain('e');
  });

  it('round-trips correctly', () => {
    const original = '123456.789012345678';
    expect(fromDecimal(toDecimal(original))).toBe(original);
  });
});

describe('addMoney', () => {
  it('adds without float drift (0.1 + 0.2 = 0.3)', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3');
  });

  it('adds large numbers', () => {
    expect(addMoney('999999999.99', '0.01')).toBe('1000000000');
  });
});

describe('subtractMoney', () => {
  it('subtracts correctly', () => {
    expect(subtractMoney('1000', '0.01')).toBe('999.99');
  });

  it('produces negative results', () => {
    expect(subtractMoney('100', '200')).toBe('-100');
  });
});

describe('multiplyMoney', () => {
  it('multiplies correctly', () => {
    expect(multiplyMoney('100', '0.26375')).toBe('26.375');
  });
});

describe('compareMoney', () => {
  it('returns 0 for equal values', () => {
    expect(compareMoney('100', '100')).toBe(0);
  });

  it('returns 1 when a > b', () => {
    expect(compareMoney('1000.01', '1000')).toBe(1);
  });

  it('returns -1 when a < b', () => {
    expect(compareMoney('999.99', '1000')).toBe(-1);
  });
});

describe('isZero', () => {
  it('detects zero', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('0.00')).toBe(true);
  });

  it('detects non-zero', () => {
    expect(isZero('0.001')).toBe(false);
  });
});

describe('isNegative', () => {
  it('detects negative', () => {
    expect(isNegative('-1')).toBe(true);
  });

  it('detects non-negative zero', () => {
    expect(isNegative('0')).toBe(false);
  });

  it('detects non-negative positive', () => {
    expect(isNegative('1')).toBe(false);
  });
});

describe('ZERO constant', () => {
  it('is zero', () => {
    expect(ZERO.isZero()).toBe(true);
  });
});

describe('Decimal precision', () => {
  it('maintains 36-digit precision', () => {
    expect(Decimal.precision).toBe(36);
  });
});
