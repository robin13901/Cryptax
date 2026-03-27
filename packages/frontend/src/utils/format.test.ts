import { describe, expect, it } from 'vitest';
import { formatEur, formatNumber, formatPercent, gainLossColor } from './format';

describe('formatEur', () => {
  it('formats a string MoneyString in German locale with EUR currency', () => {
    const result = formatEur('1234.56');
    expect(result).toContain('1.234,56');
    // de-DE locale renders EUR as '€' symbol in most environments
    expect(result).toMatch(/EUR|€/);
  });

  it('formats a numeric value in German locale with EUR currency', () => {
    const result = formatEur(1234.56);
    expect(result).toContain('1.234,56');
    expect(result).toMatch(/EUR|€/);
  });

  it('formats zero as 0,00 EUR (not "--")', () => {
    const result = formatEur(0);
    expect(result).toContain('0,00');
    expect(result).toMatch(/EUR|€/);
    expect(result).not.toBe('--');
  });

  it('returns "--" for non-numeric string input', () => {
    expect(formatEur('not-a-number')).toBe('--');
  });

  it('includes negative sign for negative value with showSign=true', () => {
    const result = formatEur('-500.50', true);
    expect(result).toMatch(/[-−]/);
    expect(result).toContain('500,50');
  });

  it('includes positive sign indicator for positive value with showSign=true', () => {
    const result = formatEur('999.99', true);
    expect(result).toMatch(/[+]/);
    expect(result).toContain('999,99');
  });
});

describe('formatNumber', () => {
  it('formats a string number in German locale with 2 decimal places', () => {
    const result = formatNumber('1234.567', 2);
    expect(result).toBe('1.234,57');
  });

  it('formats zero as "0,00"', () => {
    expect(formatNumber('0')).toBe('0,00');
  });

  it('formats numeric value with specified decimals', () => {
    expect(formatNumber(1234.5, 0)).toBe('1.235');
  });

  it('returns "--" for non-numeric string', () => {
    expect(formatNumber('not-a-number')).toBe('--');
  });
});

describe('formatPercent', () => {
  it('formats a ratio as percentage containing "75,3" for 0.7532', () => {
    const result = formatPercent(0.7532);
    expect(result).toContain('75,3');
  });

  it('formats 1.0 as percentage containing "100"', () => {
    const result = formatPercent(1.0);
    expect(result).toContain('100');
  });

  it('returns "--" for NaN', () => {
    expect(formatPercent(NaN)).toBe('--');
  });

  it('formats with custom decimal places', () => {
    const result = formatPercent(0.5, 2);
    expect(result).toContain('50,00');
  });
});

describe('gainLossColor', () => {
  it('returns green accent for positive value', () => {
    expect(gainLossColor('100')).toBe('var(--accent-green, #34d399)');
  });

  it('returns red accent for negative value', () => {
    expect(gainLossColor('-50')).toBe('var(--accent-red, #f87171)');
  });

  it('returns neutral color for zero', () => {
    expect(gainLossColor('0')).toBe('var(--text-secondary, rgba(255,255,255,0.6))');
  });

  it('returns neutral color for NaN string', () => {
    expect(gainLossColor('NaN')).toBe('var(--text-secondary, rgba(255,255,255,0.6))');
  });

  it('returns green accent for positive number', () => {
    expect(gainLossColor(42)).toBe('var(--accent-green, #34d399)');
  });

  it('returns red accent for negative number', () => {
    expect(gainLossColor(-1)).toBe('var(--accent-red, #f87171)');
  });
});
