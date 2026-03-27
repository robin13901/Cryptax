import { describe, expect, it } from 'vitest';
import { parseSymbol, usesCsvFillPrice } from './symbol-parser.js';

describe('parseSymbol', () => {
  describe('spot_order', () => {
    it('parses BTC/EUR → base BTC, quote EUR, bitgetSymbol BTCEUR', () => {
      const result = parseSymbol('BTC/EUR', 'spot_order');
      expect(result).toEqual({ base: 'BTC', quote: 'EUR', bitgetSymbol: 'BTCEUR' });
    });

    it('parses ETH/USDT → base ETH, quote USDT, bitgetSymbol ETHUSDT', () => {
      const result = parseSymbol('ETH/USDT', 'spot_order');
      expect(result).toEqual({ base: 'ETH', quote: 'USDT', bitgetSymbol: 'ETHUSDT' });
    });
  });

  describe('spot_tx', () => {
    it('parses BTC → base BTC, quote null, bitgetSymbol BTCEUR', () => {
      const result = parseSymbol('BTC', 'spot_tx');
      expect(result).toEqual({ base: 'BTC', quote: null, bitgetSymbol: 'BTCEUR' });
    });
  });

  describe('futures_order', () => {
    it('parses BTCUSDT → base BTC, quote USDT, bitgetSymbol BTCUSDT', () => {
      const result = parseSymbol('BTCUSDT', 'futures_order');
      expect(result).toEqual({ base: 'BTC', quote: 'USDT', bitgetSymbol: 'BTCUSDT' });
    });

    it('parses ETHUSDT → base ETH, quote USDT, bitgetSymbol ETHUSDT', () => {
      const result = parseSymbol('ETHUSDT', 'futures_order');
      expect(result).toEqual({ base: 'ETH', quote: 'USDT', bitgetSymbol: 'ETHUSDT' });
    });
  });

  describe('futures_tx', () => {
    it('parses BTCUSDT same as futures_order → base BTC, quote USDT', () => {
      const result = parseSymbol('BTCUSDT', 'futures_tx');
      expect(result).toEqual({ base: 'BTC', quote: 'USDT', bitgetSymbol: 'BTCUSDT' });
    });
  });

  describe('earn', () => {
    it('parses ETH → base ETH, quote null, bitgetSymbol ETHEUR', () => {
      const result = parseSymbol('ETH', 'earn');
      expect(result).toEqual({ base: 'ETH', quote: null, bitgetSymbol: 'ETHEUR' });
    });
  });
});

describe('usesCsvFillPrice', () => {
  it('returns true for spot_order with EUR pair and non-zero price', () => {
    expect(usesCsvFillPrice('spot_order', 'BTC/EUR', '45000')).toBe(true);
  });

  it('returns false for spot_order with non-EUR quote (USDT)', () => {
    expect(usesCsvFillPrice('spot_order', 'BTC/USDT', '45000')).toBe(false);
  });

  it('returns false for spot_order with EUR pair but zero price', () => {
    expect(usesCsvFillPrice('spot_order', 'BTC/EUR', '0')).toBe(false);
  });

  it('returns false for spot_tx even with BTC and non-zero price', () => {
    expect(usesCsvFillPrice('spot_tx', 'BTC', '45000')).toBe(false);
  });

  it('returns false for spot_order with EUR pair but empty price', () => {
    expect(usesCsvFillPrice('spot_order', 'BTC/EUR', '')).toBe(false);
  });
});
