import { describe, expect, it } from 'vitest';
import { normalizeToTransaction } from './normalize.js';

// ---------------------------------------------------------------------------
// Helpers — minimal CSV rows per format
// ---------------------------------------------------------------------------

const SPOT_TX_ROW: Record<string, string> = {
  order: '111',
  Date: '2024-03-15 10:30:00',
  Coin: 'BTC',
  Type: 'Buy',
  Amount: '0.5',
  Fee: '0.001',
  Available: '100',
};

const SPOT_TX_SELL_ROW: Record<string, string> = {
  order: '222',
  Date: '2024-06-01 09:00:00',
  Coin: 'ETH',
  Type: 'Sell',
  Amount: '-2.0',
  Fee: '0',
  Available: '98',
};

const FUTURES_TX_OPEN_LONG_ROW: Record<string, string> = {
  Order: '333',
  Date: '2024-09-01 12:00:00',
  Coin: 'USDT',
  Futures: 'POPCATUSDT',
  'Margin Mode': 'crossed',
  Type: 'open_long',
  Amount: '10',
  Fee: '0.05',
  'Wallet balance': '500',
};

const EARN_ROW: Record<string, string> = {
  Reference: '10001',
  'Start time': '2024-06-01 08:00:00',
  Coin: 'ETH',
  Type: 'Staking',
  'Interest coin': 'ETH',
  Amount: '0.001',
  'Handling fee': '0',
  Status: 'Staked',
};

const SPOT_ORDER_BUY_ROW: Record<string, string> = {
  Date: '2025-01-10 12:00:00',
  Type: 'Limit',
  'Order Id': '9999',
  'Trading pair': 'BTCEUR',
  'Base Asset': 'BTC',
  'Quote Asset': 'EUR',
  Direction: 'Buy',
  Price: '50000',
  'Order amount': '0.1',
  Executed: '0.1',
  'Average Price': '50100',
  'Trading volume': '5010',
  Status: 'Filled',
};

const FUTURES_ORDER_CLOSE_SHORT_ROW: Record<string, string> = {
  Date: '2025-02-01 08:00:00',
  'Order ID': '8888',
  Direction: 'Close short',
  Coin: 'USDT',
  Futures: 'BTCUSDT',
  'order source': 'normal',
  'Transaction type': 'close_short',
  Price: '',
  'Average Price': '45000',
  'Order amount': '0.5',
  Executed: '0.5',
  'Trading volume': '22500',
  'Realized P/L': '300',
  NetProfits: '295',
  Status: 'Filled',
};

// ---------------------------------------------------------------------------
// spot_tx tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — spot_tx Buy', () => {
  const tx = normalizeToTransaction(SPOT_TX_ROW, 'spot_tx', 'test.csv', SPOT_TX_ROW);

  it('canonicalType is buy', () => {
    expect(tx.canonicalType).toBe('buy');
  });

  it('side is buy', () => {
    expect(tx.side).toBe('buy');
  });

  it('price is "0" (format has no price column)', () => {
    expect(tx.price).toBe('0');
  });

  it('totalValue is "0" (format has no total value column)', () => {
    expect(tx.totalValue).toBe('0');
  });

  it('exchange is always bitget', () => {
    expect(tx.exchange).toBe('bitget');
  });

  it('taxYear is extracted from tradedAt', () => {
    expect(tx.taxYear).toBe(2024);
  });

  it('sourceType is spot_tx', () => {
    expect(tx.sourceType).toBe('spot_tx');
  });

  it('symbol is the Coin column', () => {
    expect(tx.symbol).toBe('BTC');
  });

  it('amount is from Amount column', () => {
    expect(tx.amount).toBe('0.5');
  });

  it('checksum is a 64-char hex string', () => {
    expect(tx.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rawRow is JSON string of original csv row', () => {
    expect(typeof tx.rawRow).toBe('string');
    const parsed = JSON.parse(tx.rawRow as string);
    expect(parsed.order).toBe('111');
  });

  it('sourceFile is the filename', () => {
    expect(tx.sourceFile).toBe('test.csv');
  });
});

describe('normalizeToTransaction — spot_tx Sell', () => {
  const tx = normalizeToTransaction(SPOT_TX_SELL_ROW, 'spot_tx', 'test.csv', SPOT_TX_SELL_ROW);

  it('canonicalType is sell', () => {
    expect(tx.canonicalType).toBe('sell');
  });

  it('side is sell', () => {
    expect(tx.side).toBe('sell');
  });
});

// ---------------------------------------------------------------------------
// futures_tx tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — futures_tx open_long', () => {
  const tx = normalizeToTransaction(
    FUTURES_TX_OPEN_LONG_ROW,
    'futures_tx',
    'futures.csv',
    FUTURES_TX_OPEN_LONG_ROW
  );

  it('canonicalType is futures_open_long', () => {
    expect(tx.canonicalType).toBe('futures_open_long');
  });

  it('side is buy', () => {
    expect(tx.side).toBe('buy');
  });

  it('symbol comes from Futures column', () => {
    expect(tx.symbol).toBe('POPCATUSDT');
  });

  it('price is "0"', () => {
    expect(tx.price).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// earn tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — earn Staking', () => {
  const tx = normalizeToTransaction(EARN_ROW, 'earn', 'earn.csv', EARN_ROW);

  it('canonicalType is earn_deposit', () => {
    expect(tx.canonicalType).toBe('earn_deposit');
  });

  it('symbol comes from Interest coin column', () => {
    expect(tx.symbol).toBe('ETH');
  });

  it('side is buy (earn_deposit maps to buy side)', () => {
    expect(tx.side).toBe('buy');
  });

  it('taxYear is 2024', () => {
    expect(tx.taxYear).toBe(2024);
  });

  it('orderId comes from Reference column', () => {
    expect(tx.orderId).toBe('10001');
  });
});

// ---------------------------------------------------------------------------
// spot_order tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — spot_order Buy', () => {
  const tx = normalizeToTransaction(
    SPOT_ORDER_BUY_ROW,
    'spot_order',
    'spot-orders.csv',
    SPOT_ORDER_BUY_ROW
  );

  it('canonicalType is buy', () => {
    expect(tx.canonicalType).toBe('buy');
  });

  it('price comes from Average Price column', () => {
    expect(tx.price).toBe('50100');
  });

  it('totalValue comes from Trading volume column', () => {
    expect(tx.totalValue).toBe('5010');
  });

  it('symbol is BASE/QUOTE format', () => {
    expect(tx.symbol).toBe('BTC/EUR');
  });
});

// ---------------------------------------------------------------------------
// futures_order tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — futures_order Close short', () => {
  const tx = normalizeToTransaction(
    FUTURES_ORDER_CLOSE_SHORT_ROW,
    'futures_order',
    'futures-orders.csv',
    FUTURES_ORDER_CLOSE_SHORT_ROW
  );

  it('canonicalType is futures_close_short', () => {
    expect(tx.canonicalType).toBe('futures_close_short');
  });

  it('side is buy (closing short position = buying back)', () => {
    expect(tx.side).toBe('buy');
  });

  it('symbol comes from Futures column', () => {
    expect(tx.symbol).toBe('BTCUSDT');
  });
});

// ---------------------------------------------------------------------------
// Unknown type tests
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — unknown type', () => {
  const unknownRow = { ...SPOT_TX_ROW, Type: 'SomeFutureType' };
  const tx = normalizeToTransaction(unknownRow, 'spot_tx', 'test.csv', unknownRow);

  it('canonicalType is "unknown" for unrecognised type string', () => {
    expect(tx.canonicalType).toBe('unknown');
  });

  it('side is null for unknown canonical type', () => {
    expect(tx.side).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// taxYear extraction
// ---------------------------------------------------------------------------

describe('normalizeToTransaction — taxYear extraction', () => {
  it('extracts 2024 from "2024-03-15 10:30:00"', () => {
    const row = { ...SPOT_TX_ROW, Date: '2024-03-15 10:30:00' };
    const tx = normalizeToTransaction(row, 'spot_tx', 'test.csv', row);
    expect(tx.taxYear).toBe(2024);
  });

  it('extracts 2025 from "2025-12-31 23:59:59"', () => {
    const row = { ...SPOT_TX_ROW, Date: '2025-12-31 23:59:59' };
    const tx = normalizeToTransaction(row, 'spot_tx', 'test.csv', row);
    expect(tx.taxYear).toBe(2025);
  });

  it('extracts 2023 from "2023-01-01 00:00:00"', () => {
    const row = { ...SPOT_TX_ROW, Date: '2023-01-01 00:00:00' };
    const tx = normalizeToTransaction(row, 'spot_tx', 'test.csv', row);
    expect(tx.taxYear).toBe(2023);
  });
});
