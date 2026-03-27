import { describe, expect, it } from 'vitest';
import { berlinToUtcMs } from './timezone.js';

describe('berlinToUtcMs', () => {
  it('converts standard CET time (UTC+1) correctly', () => {
    // 2024-01-15 14:30:00 Berlin (CET = UTC+1) → 2024-01-15T13:30:00Z
    const result = berlinToUtcMs('2024-01-15 14:30:00');
    expect(result).toBe(new Date('2024-01-15T13:30:00Z').getTime());
  });

  it('converts standard CEST time (UTC+2) correctly', () => {
    // 2024-07-15 14:30:00 Berlin (CEST = UTC+2) → 2024-07-15T12:30:00Z
    const result = berlinToUtcMs('2024-07-15 14:30:00');
    expect(result).toBe(new Date('2024-07-15T12:30:00Z').getTime());
  });

  it('handles DST spring-forward gap (2024-03-31 02:30:00 does not exist in Berlin)', () => {
    // 2024-03-31: clocks spring forward from 02:00 CET to 03:00 CEST.
    // 02:30 Berlin does not exist. date-fns-tz fromZonedTime treats it identically
    // to 01:30 CET (resolves the wall-clock time before the gap), producing 00:30 UTC.
    // → 2024-03-31T00:30:00Z
    const result = berlinToUtcMs('2024-03-31 02:30:00');
    expect(result).toBe(new Date('2024-03-31T00:30:00Z').getTime());
  });

  it('handles DST fall-back ambiguity (2024-10-27 02:30:00 is ambiguous in Berlin)', () => {
    // 2024-10-27: clocks fall back from 03:00 CEST to 02:00 CET.
    // 02:30 Berlin occurs twice. date-fns-tz fromZonedTime resolves to the second
    // occurrence (CET = UTC+1), producing 01:30 UTC.
    // → 2024-10-27T01:30:00Z
    const result = berlinToUtcMs('2024-10-27 02:30:00');
    expect(result).toBe(new Date('2024-10-27T01:30:00Z').getTime());
  });

  it('converts midnight boundary correctly', () => {
    // 2024-01-01 00:00:00 Berlin (CET = UTC+1) → 2023-12-31T23:00:00Z
    const result = berlinToUtcMs('2024-01-01 00:00:00');
    expect(result).toBe(new Date('2023-12-31T23:00:00Z').getTime());
  });

  it('returns a numeric UTC millisecond timestamp', () => {
    const result = berlinToUtcMs('2024-06-01 10:00:00');
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });
});
