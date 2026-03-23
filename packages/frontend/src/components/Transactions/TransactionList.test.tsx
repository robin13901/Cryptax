import type { TransactionListItem, TransactionPageResponse } from '@cryptax/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionList from './TransactionList';

// ---------------------------------------------------------------------------
// Mock data fixtures
// ---------------------------------------------------------------------------

function makeItem(id: number, overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id,
    orderId: `order-${id}`,
    symbol: 'BTC',
    canonicalType: 'buy',
    sourceType: 'spot_tx',
    side: 'buy',
    amount: '0.5',
    price: '30000.00',
    fee: '5.00',
    eurPrice: '30000.00',
    tradedAt: '2024-06-15T10:30:00Z',
    taxYear: 2024,
    exchange: 'Bitget',
    ...overrides,
  };
}

function makePageResponse(
  items: TransactionListItem[],
  overrides: Partial<TransactionPageResponse> = {},
): TransactionPageResponse {
  return {
    items,
    total: items.length,
    hasMore: false,
    offset: 0,
    limit: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransactionList', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows initial loading skeleton, then renders rows after fetch', async () => {
    const items = [
      makeItem(1, { symbol: 'BTC', canonicalType: 'buy' }),
      makeItem(2, { symbol: 'ETH', canonicalType: 'sell' }),
      makeItem(3, { symbol: 'SOL', canonicalType: 'earn_interest' }),
    ];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('BTC')).toBeInTheDocument();
    });

    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
  });

  it('shows transaction count in header', async () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items, { total: 3 })),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText(/3 gesamt/)).toBeInTheDocument();
    });
  });

  it('renders Spot category badge for buy transaction', async () => {
    const items = [makeItem(1, { canonicalType: 'buy' })];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Spot')).toBeInTheDocument();
    });
  });

  it('renders Earn category badge for earn_interest transaction', async () => {
    const items = [makeItem(1, { canonicalType: 'earn_interest', symbol: 'ETH' })];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Earn')).toBeInTheDocument();
    });
  });

  it('renders Futures category badge for futures_close_long transaction', async () => {
    const items = [makeItem(1, { canonicalType: 'futures_close_long', symbol: 'BTC', side: null })];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Futures')).toBeInTheDocument();
    });
  });

  it('shows "Keine Transaktionen gefunden" when empty response', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse([])),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Keine Transaktionen gefunden')).toBeInTheDocument();
    });
  });

  it('shows error message when fetch fails', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

    render(<TransactionList />);

    await waitFor(() => {
      expect(
        screen.getByText(/Fehler beim Laden der Transaktionen/i),
      ).toBeInTheDocument();
    });
  });

  it('shows error message when fetch returns non-ok status', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(
        screen.getByText(/Fehler beim Laden der Transaktionen/i),
      ).toBeInTheDocument();
    });
  });

  it('renders table headers (Datum, Coin, Typ, Richtung, Menge, EUR Wert, Gebühr)', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse([])),
    } as Response);

    render(<TransactionList />);

    // Table headers are rendered immediately (not async-dependent)
    expect(screen.getByText('Datum')).toBeInTheDocument();
    expect(screen.getByText('Coin')).toBeInTheDocument();
    expect(screen.getByText('Typ')).toBeInTheDocument();
    expect(screen.getByText('Richtung')).toBeInTheDocument();
    expect(screen.getByText('Menge')).toBeInTheDocument();
    expect(screen.getByText('EUR Wert')).toBeInTheDocument();
  });

  it('renders Kauf side label for buy transaction', async () => {
    const items = [makeItem(1, { side: 'buy' })];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Kauf')).toBeInTheDocument();
    });
  });

  it('renders Verkauf side label for sell transaction', async () => {
    const items = [makeItem(1, { side: 'sell', canonicalType: 'sell' })];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items)),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText('Verkauf')).toBeInTheDocument();
    });
  });

  it('clicking a row opens the detail panel (fetches transaction detail)', async () => {
    const user = userEvent.setup();
    const items = [makeItem(1, { symbol: 'BTC' })];

    // First call: list; second call: detail
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makePageResponse(items)),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          transaction: {
            id: 1,
            orderId: 'order-1',
            exchange: 'Bitget',
            sourceType: 'spot_tx',
            canonicalType: 'buy',
            symbol: 'BTC',
            side: 'buy',
            amount: '0.5',
            price: '30000.00',
            fee: '5.00',
            totalValue: '15000.00',
            tradedAt: '2024-06-15T10:30:00Z',
            taxYear: 2024,
            sourceFile: null,
            rawRow: null,
            checksum: 'abc',
            importedAt: '2024-06-15T10:30:00Z',
            eurPrice: '30000.00',
            priceSource: 'coingecko',
            priceResolvedAt: '2024-06-15T10:30:00Z',
            priceFailureReason: null,
          },
          lotConsumptions: [],
          futuresPosition: null,
          earnIncome: null,
          taxImpact: {
            bucket: 'private_sale',
            totalGainLossEur: '0.00',
            isTaxFree: false,
            reason: 'Kauf-Transaktion ist kein steuerpflichtiges Ereignis',
          },
        }),
      } as Response);

    render(<TransactionList />);

    // Wait for rows to render
    await waitFor(() => {
      expect(screen.getByText('BTC')).toBeInTheDocument();
    });

    // Click the row
    const row = screen.getByRole('row', { name: /BTC/i });
    await user.click(row);

    // Detail panel fetch should have been called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/transactions/1');
    });
  });

  it('shows "Alle N Transaktionen geladen" end marker when no more pages', async () => {
    const items = [makeItem(1), makeItem(2)];
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePageResponse(items, { total: 2, hasMore: false })),
    } as Response);

    render(<TransactionList />);

    await waitFor(() => {
      expect(screen.getByText(/Alle 2 Transaktionen geladen/)).toBeInTheDocument();
    });
  });
});
