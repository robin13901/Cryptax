import { describe, expect, it } from 'vitest';
import { CANONICAL_TYPE_MAP, mapCanonicalType } from './type-map.js';

// ---------------------------------------------------------------------------
// Explicit mapping tests — all 22 raw type strings
// ---------------------------------------------------------------------------

describe('CANONICAL_TYPE_MAP — spot_tx (14 entries)', () => {
  it('Buy -> buy', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Buy).toBe('buy');
  });
  it('Sell -> sell', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Sell).toBe('sell');
  });
  it('Interest -> earn_interest', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Interest).toBe('earn_interest');
  });
  it('Gains -> earn_interest', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Gains).toBe('earn_interest');
  });
  it('Financial -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Financial).toBe('transfer_in');
  });
  it('Deposit -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Deposit).toBe('transfer_in');
  });
  it('"Deposit credited" -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Deposit credited']).toBe('transfer_in');
  });
  it('"Automatic deposit" -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Automatic deposit']).toBe('transfer_in');
  });
  it('"Transfer out" -> transfer_out', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Transfer out']).toBe('transfer_out');
  });
  it('"Automatic withdrawal" -> transfer_out', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Automatic withdrawal']).toBe('transfer_out');
  });
  it('Consumption -> transfer_out', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx.Consumption).toBe('transfer_out');
  });
  it('"Position profit" -> futures_funding', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Position profit']).toBe('futures_funding');
  });
  it('"Exchange income" -> buy', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Exchange income']).toBe('buy');
  });
  it('"Exchange spending" -> sell', () => {
    expect(CANONICAL_TYPE_MAP.spot_tx['Exchange spending']).toBe('sell');
  });
});

describe('CANONICAL_TYPE_MAP — futures_tx (9 entries)', () => {
  it('open_long -> futures_open_long', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.open_long).toBe('futures_open_long');
  });
  it('open_short -> futures_open_short', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.open_short).toBe('futures_open_short');
  });
  it('close_long -> futures_close_long', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.close_long).toBe('futures_close_long');
  });
  it('close_short -> futures_close_short', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.close_short).toBe('futures_close_short');
  });
  it('burst_close_short -> futures_close_short', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.burst_close_short).toBe('futures_close_short');
  });
  it('contract_main_settle_fee -> futures_funding', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.contract_main_settle_fee).toBe('futures_funding');
  });
  it('trans_from_exchange -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.trans_from_exchange).toBe('transfer_in');
  });
  it('transfer_from_future_copytrade -> transfer_in', () => {
    expect(CANONICAL_TYPE_MAP.futures_tx.transfer_from_future_copytrade).toBe('transfer_in');
  });
  it('risk_captital_user_transfer -> transfer_in (Bitget typo preserved)', () => {
    // CRITICAL: "captital" is Bitget's exact typo — must NOT be corrected
    expect(CANONICAL_TYPE_MAP.futures_tx.risk_captital_user_transfer).toBe('transfer_in');
    // Correct spelling must NOT match (would be a false positive if someone "fixed" the typo)
    expect(CANONICAL_TYPE_MAP.futures_tx.risk_capital_user_transfer).toBeUndefined();
  });
});

describe('CANONICAL_TYPE_MAP — earn (1 entry)', () => {
  it('Staking -> earn_deposit', () => {
    expect(CANONICAL_TYPE_MAP.earn.Staking).toBe('earn_deposit');
  });
});

describe('CANONICAL_TYPE_MAP — spot_order (2 entries)', () => {
  it('Buy -> buy', () => {
    expect(CANONICAL_TYPE_MAP.spot_order.Buy).toBe('buy');
  });
  it('Sell -> sell', () => {
    expect(CANONICAL_TYPE_MAP.spot_order.Sell).toBe('sell');
  });
});

describe('CANONICAL_TYPE_MAP — futures_order (4 entries)', () => {
  it('"Open long" -> futures_open_long', () => {
    expect(CANONICAL_TYPE_MAP.futures_order['Open long']).toBe('futures_open_long');
  });
  it('"Close long" -> futures_close_long', () => {
    expect(CANONICAL_TYPE_MAP.futures_order['Close long']).toBe('futures_close_long');
  });
  it('"Open short" -> futures_open_short', () => {
    expect(CANONICAL_TYPE_MAP.futures_order['Open short']).toBe('futures_open_short');
  });
  it('"Close short" -> futures_close_short', () => {
    expect(CANONICAL_TYPE_MAP.futures_order['Close short']).toBe('futures_close_short');
  });
});

// ---------------------------------------------------------------------------
// mapCanonicalType
// ---------------------------------------------------------------------------

describe('mapCanonicalType', () => {
  it('returns correct canonical type for known spot_tx types', () => {
    expect(mapCanonicalType('spot_tx', 'Buy')).toBe('buy');
    expect(mapCanonicalType('spot_tx', 'Sell')).toBe('sell');
    expect(mapCanonicalType('spot_tx', 'Interest')).toBe('earn_interest');
  });

  it('returns correct canonical type for known futures_tx types', () => {
    expect(mapCanonicalType('futures_tx', 'open_long')).toBe('futures_open_long');
    expect(mapCanonicalType('futures_tx', 'close_short')).toBe('futures_close_short');
    expect(mapCanonicalType('futures_tx', 'risk_captital_user_transfer')).toBe('transfer_in');
  });

  it('returns correct canonical type for earn format', () => {
    expect(mapCanonicalType('earn', 'Staking')).toBe('earn_deposit');
  });

  it('returns correct canonical type for spot_order', () => {
    expect(mapCanonicalType('spot_order', 'Buy')).toBe('buy');
    expect(mapCanonicalType('spot_order', 'Sell')).toBe('sell');
  });

  it('returns correct canonical type for futures_order', () => {
    expect(mapCanonicalType('futures_order', 'Open long')).toBe('futures_open_long');
    expect(mapCanonicalType('futures_order', 'Close short')).toBe('futures_close_short');
  });

  it('returns "unknown" for unrecognised type strings', () => {
    expect(mapCanonicalType('spot_tx', 'FutureUnknownType')).toBe('unknown');
    expect(mapCanonicalType('futures_tx', 'mystery_action')).toBe('unknown');
    expect(mapCanonicalType('earn', 'YieldFarming')).toBe('unknown');
  });

  it('is case-sensitive — lowercase "buy" does not match "Buy"', () => {
    expect(mapCanonicalType('spot_tx', 'buy')).toBe('unknown');
    expect(mapCanonicalType('spot_tx', 'sell')).toBe('unknown');
  });

  it('does not match corrected spelling of Bitget typo', () => {
    expect(mapCanonicalType('futures_tx', 'risk_capital_user_transfer')).toBe('unknown');
  });
});
