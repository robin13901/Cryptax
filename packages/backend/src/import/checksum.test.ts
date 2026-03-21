import { describe, expect, it } from 'vitest';
import { computeChecksum } from './checksum.js';

describe('computeChecksum', () => {
  it('returns a 64-character hex string', () => {
    const row = { order: '12345', Date: '2024-01-01', Amount: '1.0' };
    const result = computeChecksum(row);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same checksum for identical row content', () => {
    const row = { order: '99', Date: '2024-06-15 12:00:00', Coin: 'BTC', Amount: '0.5' };
    expect(computeChecksum(row)).toBe(computeChecksum(row));
  });

  it('produces the same checksum for two separate equal objects', () => {
    const row1 = { order: '42', Date: '2025-03-01', Type: 'Buy', Amount: '100' };
    const row2 = { order: '42', Date: '2025-03-01', Type: 'Buy', Amount: '100' };
    expect(computeChecksum(row1)).toBe(computeChecksum(row2));
  });

  it('produces different checksums for different row content', () => {
    const row1 = { order: '1', Amount: '100' };
    const row2 = { order: '1', Amount: '200' };
    expect(computeChecksum(row1)).not.toBe(computeChecksum(row2));
  });

  it('produces different checksums when a field value changes', () => {
    const base = { order: '77', Date: '2024-01-01', Type: 'Buy' };
    const modified = { order: '77', Date: '2024-01-01', Type: 'Sell' };
    expect(computeChecksum(base)).not.toBe(computeChecksum(modified));
  });

  it('produces different checksums for different order IDs', () => {
    const row1 = { order: 'AAA', Amount: '50' };
    const row2 = { order: 'BBB', Amount: '50' };
    expect(computeChecksum(row1)).not.toBe(computeChecksum(row2));
  });

  it('handles empty row without throwing', () => {
    const result = computeChecksum({});
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
