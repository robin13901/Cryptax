import { describe, expect, it } from 'vitest';
import { detectDelimiter, detectFormat } from './detect-format.js';

// ---------------------------------------------------------------------------
// detectDelimiter
// ---------------------------------------------------------------------------

describe('detectDelimiter', () => {
  it('returns ";" when semicolons outnumber commas', () => {
    // 2024 spot tx header — 6 semicolons, 0 commas
    const line = 'order;Date;Coin;Type;Amount;Fee;Available';
    expect(detectDelimiter(line)).toBe(';');
  });

  it('returns "," when commas outnumber semicolons', () => {
    // 2025 spot tx header — 6 commas, 0 semicolons
    const line = 'order,Date,Coin,Type,Amount,Fee,Available';
    expect(detectDelimiter(line)).toBe(',');
  });

  it('returns "," for futures tx header', () => {
    const line = 'Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance';
    expect(detectDelimiter(line)).toBe(',');
  });

  it('returns "," when no delimiters present (defaults to comma)', () => {
    expect(detectDelimiter('NoDelimiters')).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

// Actual headers from raw-bitget-exports/ files (verified against real CSVs)
const SPOT_TX_2024_HEADER = 'order;Date;Coin;Type;Amount;Fee;Available';
const SPOT_TX_2025_HEADER = 'order,Date,Coin,Type,Amount,Fee,Available';
const FUTURES_TX_HEADER = 'Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance';
const EARN_HEADER = 'Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status';
const SPOT_ORDER_HEADER =
  'Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status';
const FUTURES_ORDER_HEADER =
  'Date,Order ID,Direction,Coin,Futures,order source,Transaction type,Price,Average Price,Order amount,Executed,Trading volume,Realized P/L,NetProfits,Status';

describe('detectFormat', () => {
  it('detects earn format from Reference + Interest coin columns', () => {
    expect(detectFormat(`${EARN_HEADER}\nsome,data,row`)).toBe('earn');
  });

  it('detects futures_order format from NetProfits + Realized P/L columns', () => {
    expect(detectFormat(`${FUTURES_ORDER_HEADER}\nsome,data,row`)).toBe('futures_order');
  });

  it('detects spot_order format from Trading pair + Base Asset columns', () => {
    expect(detectFormat(`${SPOT_ORDER_HEADER}\nsome,data,row`)).toBe('spot_order');
  });

  it('detects futures_tx format from Futures + Wallet balance columns', () => {
    expect(detectFormat(`${FUTURES_TX_HEADER}\nsome,data,row`)).toBe('futures_tx');
  });

  it('detects spot_tx from 2024 semicolon-delimited header', () => {
    expect(detectFormat(`${SPOT_TX_2024_HEADER}\nsome;data;row`)).toBe('spot_tx');
  });

  it('detects spot_tx from 2025 comma-delimited header', () => {
    expect(detectFormat(`${SPOT_TX_2025_HEADER}\nsome,data,row`)).toBe('spot_tx');
  });

  it('both 2024 and 2025 spot tx formats return "spot_tx"', () => {
    expect(detectFormat(`${SPOT_TX_2024_HEADER}\n1;2;3;4;5;6;7`)).toBe('spot_tx');
    expect(detectFormat(`${SPOT_TX_2025_HEADER}\n1,2,3,4,5,6,7`)).toBe('spot_tx');
  });

  it('handles BOM-prefixed files correctly', () => {
    const withBom = `\uFEFF${EARN_HEADER}\nsome,data,row`;
    expect(detectFormat(withBom)).toBe('earn');
  });

  it('handles BOM-prefixed spot_tx correctly', () => {
    const withBom = `\uFEFF${SPOT_TX_2025_HEADER}\nsome,data,row`;
    expect(detectFormat(withBom)).toBe('spot_tx');
  });

  it('handles BOM-prefixed futures_order correctly', () => {
    const withBom = `\uFEFF${FUTURES_ORDER_HEADER}\nsome,data,row`;
    expect(detectFormat(withBom)).toBe('futures_order');
  });

  it('throws an error for an unknown header', () => {
    const unknownHeader = 'col1,col2,col3\ndata';
    expect(() => detectFormat(unknownHeader)).toThrow(/Unknown CSV format/);
  });

  it('includes header content in the error message', () => {
    const unknownHeader = 'foo,bar,baz\ndata';
    expect(() => detectFormat(unknownHeader)).toThrow('foo,bar,baz');
  });
});
