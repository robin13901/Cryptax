import { fromZonedTime } from 'date-fns-tz';

/**
 * Converts a "YYYY-MM-DD HH:mm:ss" string in Europe/Berlin local time to UTC milliseconds.
 *
 * Handles DST transitions:
 * - CET (UTC+1): standard winter time
 * - CEST (UTC+2): summer time
 * - Spring-forward gap (e.g. 2024-03-31 02:30:00 does not exist in Berlin): resolves
 *   using CET (UTC+1) offset, consistent with date-fns-tz behaviour for non-existent times.
 * - Fall-back ambiguity (e.g. 2024-10-27 02:30:00 exists twice): resolves to the first
 *   occurrence (CEST, UTC+2).
 */
export function berlinToUtcMs(tradedAt: string): number {
  // Replace space separator with 'T' so the string is parsed as a date-time,
  // not a date (which would be midnight UTC, ignoring the time component).
  const isoLike = tradedAt.replace(' ', 'T');
  const utcDate = fromZonedTime(isoLike, 'Europe/Berlin');
  return utcDate.getTime();
}
