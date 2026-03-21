import { describe, expect, it } from 'vitest';
import { parseRawCSV } from './parse-csv.js';

// ---------------------------------------------------------------------------
// Helpers to build minimal synthetic CSV files
// ---------------------------------------------------------------------------

function buildCsv(header: string, rows: string[]): string {
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Spot TX — semicolon delimited (2024)
// ---------------------------------------------------------------------------

const SPOT_TX_SEMI_HEADER = 'order;Date;Coin;Type;Amount;Fee;Available';
const SPOT_TX_COMMA_HEADER = 'order,Date,Coin,Type,Amount,Fee,Available';

describe('parseRawCSV — spot_tx semicolon (2024)', () => {
  const csv = buildCsv(SPOT_TX_SEMI_HEADER, [
    '\t111;2024-01-01 00:00:00;BTC;Buy;1.0;0;100',
    '\t222;2024-01-02 00:00:00;ETH;Sell;-2.0;0.01;98',
    '\t333;2024-01-03 00:00:00;EUR;Deposit;500;0;598',
  ]);

  it('detects spot_tx format', () => {
    const result = parseRawCSV(csv);
    expect(result.format).toBe('spot_tx');
  });

  it('detects semicolon delimiter', () => {
    const result = parseRawCSV(csv);
    expect(result.delimiter).toBe(';');
  });

  it('returns 3 rows', () => {
    const result = parseRawCSV(csv);
    expect(result.rows).toHaveLength(3);
  });

  it('trims the tab-prefixed order ID', () => {
    const result = parseRawCSV(csv);
    // csv-parse trim:true strips leading tab
    expect(result.rows[0].order).toBe('111');
  });
});

// ---------------------------------------------------------------------------
// Spot TX — comma delimited (2025)
// ---------------------------------------------------------------------------

describe('parseRawCSV — spot_tx comma (2025)', () => {
  const csv = buildCsv(SPOT_TX_COMMA_HEADER, [
    '\t999,2025-03-01 10:00:00,USDT,Interest,5.0,0,1000',
    '\t888,2025-03-02 11:00:00,EUR,Buy,200,0,1200',
  ]);

  it('detects spot_tx format', () => {
    expect(parseRawCSV(csv).format).toBe('spot_tx');
  });

  it('detects comma delimiter', () => {
    expect(parseRawCSV(csv).delimiter).toBe(',');
  });

  it('returns 2 rows', () => {
    expect(parseRawCSV(csv).rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Earn — comma delimited
// ---------------------------------------------------------------------------

describe('parseRawCSV — earn', () => {
  const header = 'Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status';
  const csv = buildCsv(header, ['10001,2024-06-01 08:00:00,ETH,Staking,ETH,0.001,0,Staked']);

  it('detects earn format', () => {
    expect(parseRawCSV(csv).format).toBe('earn');
  });

  it('returns 1 row', () => {
    expect(parseRawCSV(csv).rows).toHaveLength(1);
  });

  it('parses Interest coin column correctly', () => {
    const { rows } = parseRawCSV(csv);
    expect(rows[0]['Interest coin']).toBe('ETH');
  });
});

// ---------------------------------------------------------------------------
// BOM handling
// ---------------------------------------------------------------------------

describe('parseRawCSV — BOM stripping', () => {
  it('parses BOM-prefixed spot_tx file without corruption', () => {
    const csv = `\uFEFF${SPOT_TX_COMMA_HEADER}\n\t777,2025-01-01 00:00:00,BTC,Buy,1,0,1`;
    const result = parseRawCSV(csv);
    expect(result.format).toBe('spot_tx');
    expect(result.rows).toHaveLength(1);
    // First column header must not include BOM
    expect(Object.keys(result.rows[0])[0]).toBe('order');
  });

  it('strips BOM and parses earn correctly', () => {
    const header = '\uFEFFReference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status';
    const csv = `${header}\n10002,2024-06-02 09:00:00,BTC,Staking,BTC,0.0001,0,Staked`;
    const result = parseRawCSV(csv);
    expect(result.format).toBe('earn');
    expect(result.rows[0].Reference).toBe('10002');
  });
});

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

describe('parseRawCSV — trim', () => {
  it('trims tab-prefixed values', () => {
    const csv = `${SPOT_TX_COMMA_HEADER}\n\t12345,2025-01-01 00:00:00,BTC,Buy,1,0,100`;
    const { rows } = parseRawCSV(csv);
    // csv-parse trim:true must strip the leading tab from the order field
    expect(rows[0].order).toBe('12345');
    expect(rows[0].order).not.toMatch(/^\t/);
  });
});

// ---------------------------------------------------------------------------
// Empty lines skipped
// ---------------------------------------------------------------------------

describe('parseRawCSV — empty line skipping', () => {
  it('skips blank rows between data rows', () => {
    const csv =
      `${SPOT_TX_COMMA_HEADER}\n111,2025-01-01 00:00:00,BTC,Buy,1,0,100` +
      '\n' + // empty line
      '\n222,2025-01-02 00:00:00,ETH,Sell,-2,0,98';
    const { rows } = parseRawCSV(csv);
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Futures TX format detection
// ---------------------------------------------------------------------------

describe('parseRawCSV — futures_tx', () => {
  const header = 'Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance';
  const csv = buildCsv(header, [
    '\t555,2024-09-01 10:00:00,USDT,BTCUSDT,crossed,open_long,10,0.1,1000',
  ]);

  it('detects futures_tx format', () => {
    expect(parseRawCSV(csv).format).toBe('futures_tx');
  });
});

// ---------------------------------------------------------------------------
// Spot order format detection
// ---------------------------------------------------------------------------

describe('parseRawCSV — spot_order', () => {
  const header =
    'Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status';
  const csv = buildCsv(header, [
    '2025-01-10 12:00:00,Limit,\t9999,BTCEUR,BTC,EUR,Buy,50000,0.1,0.1,50100,5010,Filled',
  ]);

  it('detects spot_order format', () => {
    expect(parseRawCSV(csv).format).toBe('spot_order');
  });
});

// ---------------------------------------------------------------------------
// Futures order format detection
// ---------------------------------------------------------------------------

describe('parseRawCSV — futures_order', () => {
  const header =
    'Date,Order ID,Direction,Coin,Futures,order source,Transaction type,Price,Average Price,Order amount,Executed,Trading volume,Realized P/L,NetProfits,Status';
  const csv = buildCsv(header, [
    '2025-02-01 08:00:00,\t8888,Open long,USDT,POPCATUSDT,normal,open,,0.75,100,100,75,0,0,Filled',
  ]);

  it('detects futures_order format', () => {
    expect(parseRawCSV(csv).format).toBe('futures_order');
  });
});
