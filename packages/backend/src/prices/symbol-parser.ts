import type { SourceType } from '@cryptax/shared';

export interface ParsedSymbol {
  base: string;
  quote: string | null;
  bitgetSymbol: string;
}

// Known quote suffixes for futures symbols, ordered longest-first to prevent
// partial matches (e.g. "PERP" before shorter suffixes).
const FUTURES_QUOTE_SUFFIXES = ['USDT', 'USD', 'EUR', 'BTC', 'PERP'] as const;

/**
 * Parses a raw symbol string into base asset, quote asset, and a Bitget symbol
 * suitable for price API lookups.
 *
 * Logic per sourceType:
 *   spot_order    – "BTC/EUR"   → base BTC, quote EUR, bitgetSymbol BTCEUR
 *   spot_tx       – "BTC"       → base BTC, quote null, bitgetSymbol BTCEUR
 *   futures_order – "BTCUSDT"   → base BTC, quote USDT, bitgetSymbol BTCUSDT
 *   futures_tx    – "BTCUSDT"   → same as futures_order
 *   earn          – "ETH"       → base ETH, quote null, bitgetSymbol ETHEUR
 */
export function parseSymbol(symbol: string, sourceType: SourceType): ParsedSymbol {
  switch (sourceType) {
    case 'spot_order': {
      const slashIdx = symbol.indexOf('/');
      if (slashIdx !== -1) {
        const base = symbol.slice(0, slashIdx).toUpperCase();
        const quote = symbol.slice(slashIdx + 1).toUpperCase();
        return { base, quote, bitgetSymbol: base + quote };
      }
      // Fallback: no slash — treat as bare coin (shouldn't happen for spot_order but be safe)
      const base = symbol.toUpperCase();
      return { base, quote: null, bitgetSymbol: `${base}EUR` };
    }

    case 'spot_tx':
    case 'earn': {
      const base = symbol.toUpperCase();
      return { base, quote: null, bitgetSymbol: `${base}EUR` };
    }

    case 'futures_order':
    case 'futures_tx': {
      const upper = symbol.toUpperCase();
      for (const suffix of FUTURES_QUOTE_SUFFIXES) {
        if (upper.endsWith(suffix)) {
          const base = upper.slice(0, upper.length - suffix.length);
          if (base.length > 0) {
            return { base, quote: suffix, bitgetSymbol: upper };
          }
        }
      }
      // No known suffix matched — treat whole string as base
      return { base: upper, quote: null, bitgetSymbol: `${upper}EUR` };
    }
  }
}

/**
 * Returns true when the transaction is a spot_order where:
 *   1. The symbol's quote currency is EUR (i.e. we have a direct EUR fill price in the CSV)
 *   2. The recorded price is not '0' and not empty
 *
 * When true, downstream enrichment can use the CSV fill price as-is rather than
 * fetching from an API.
 */
export function usesCsvFillPrice(sourceType: SourceType, symbol: string, price: string): boolean {
  if (sourceType !== 'spot_order') return false;
  if (!symbol.includes('/EUR')) return false;
  if (price === '0' || price === '') return false;
  return true;
}

/**
 * Returns true when the transaction has a USDT-denominated fill price from the CSV:
 *   - spot_order with USDT quote (e.g. "MOZ/USDT") and non-zero price
 *   - futures_order with USDT quote (e.g. "POPCATUSDT") and non-zero price
 *
 * When true, the CSV price is in USDT and needs × USDT/EUR conversion.
 */
export function usesCsvUsdtPrice(sourceType: SourceType, symbol: string, price: string): boolean {
  if (price === '0' || price === '') return false;
  if (sourceType === 'spot_order' && symbol.includes('/USDT')) return true;
  if (sourceType === 'futures_order' && symbol.toUpperCase().endsWith('USDT')) return true;
  return false;
}
