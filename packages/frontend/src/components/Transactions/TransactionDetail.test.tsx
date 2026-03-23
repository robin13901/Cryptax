import type { TransactionDetailResponse } from '@cryptax/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionDetail from './TransactionDetail';

// ---------------------------------------------------------------------------
// Mock data fixtures
// ---------------------------------------------------------------------------

function makeTransaction(
  overrides: Partial<TransactionDetailResponse['transaction']> = {},
): TransactionDetailResponse['transaction'] {
  return {
    id: 42,
    orderId: 'order-42',
    exchange: 'Bitget',
    sourceType: 'spot_tx',
    canonicalType: 'sell',
    symbol: 'BTC',
    side: 'sell',
    amount: '0.25',
    price: '32000.00',
    fee: '3.20',
    totalValue: '7997.00',
    tradedAt: '2024-09-20T14:00:00Z',
    taxYear: 2024,
    sourceFile: 'spot_orders.csv',
    rawRow: null,
    checksum: 'abc123',
    importedAt: '2024-10-01T00:00:00Z',
    eurPrice: '32000.00',
    priceSource: 'coingecko',
    priceResolvedAt: '2024-09-20T14:00:01Z',
    priceFailureReason: null,
    ...overrides,
  };
}

function makeLot(id: number): TransactionDetailResponse['lotConsumptions'][number] {
  return {
    lotId: id,
    amountConsumed: '0.1',
    costBasisEur: '2500.00',
    proceedsEur: '3200.00',
    gainLossEur: '700.00',
    feeEur: '1.60',
    heldDays: 400,
    haltefristMet: true,
    acquiredAt: '2023-08-10T09:00:00Z',
    costPerUnitEur: '25000.00',
    symbol: 'BTC',
  };
}

function makeDetail(overrides: Partial<TransactionDetailResponse> = {}): TransactionDetailResponse {
  return {
    transaction: makeTransaction(),
    lotConsumptions: [],
    futuresPosition: null,
    earnIncome: null,
    taxImpact: {
      bucket: 'private_sale',
      totalGainLossEur: '700.00',
      isTaxFree: false,
      reason: '§23 EStG privates Veräußerungsgeschäft',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransactionDetail', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    hasPrev: false,
    hasNext: false,
  };

  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not visible when transactionId is null (renders nothing)', () => {
    const { container } = render(
      <TransactionDetail {...defaultProps} transactionId={null} />,
    );
    // No panel rendered when id is null
    expect(container.querySelector('.tx-detail-panel')).not.toBeInTheDocument();
    expect(container.querySelector('.tx-detail-overlay')).not.toBeInTheDocument();
  });

  it('shows loading state initially when transactionId is provided', async () => {
    vi.mocked(global.fetch).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve(makeDetail()),
      } as Response), 200)),
    );

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    // Panel should appear immediately
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Shows loading spinner text
    expect(screen.getByText(/Lade Transaktionsdetails/i)).toBeInTheDocument();
  });

  it('shows transaction data after fetch completes', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Transaktionsdaten')).toBeInTheDocument();
    });

    // Transaction fields — use getAllByText for values that appear in multiple fields
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
    // canonicalType 'sell' appears, side 'sell' also appears — check at least one
    expect(screen.getAllByText('sell').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
    // Section title
    expect(screen.getByText('Transaktionsdaten')).toBeInTheDocument();
  });

  it('calls fetch with correct transaction ID URL', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={99} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/transactions/99');
    });
  });

  it('renders FIFO lot table for sell transactions with lot consumptions', async () => {
    const detail = makeDetail({
      lotConsumptions: [makeLot(1), makeLot(2)],
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(detail),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText(/FIFO Lot-Verbrauch/i)).toBeInTheDocument();
    });

    // Table headers — use getAllByText for 'Menge' which also appears in dl
    const mengeCells = screen.getAllByText('Menge');
    expect(mengeCells.length).toBeGreaterThanOrEqual(1);
    // Use getByRole table to find the header row
    const table = screen.getByRole('table', { name: 'FIFO Lots' });
    expect(table).toBeInTheDocument();
    // Verify specific table headers
    expect(table.querySelector('th:first-child')?.textContent).toBe('Kaufdatum');
    expect(table.querySelector('th:last-child')?.textContent).toBe('Frei');

    // Two lots rendered (400 held days each)
    const daysCells = screen.getAllByText('400');
    expect(daysCells).toHaveLength(2);
  });

  it('shows Steuerfrei badge when haltefristMet is true in lot', async () => {
    const detail = makeDetail({
      lotConsumptions: [makeLot(1)],
      taxImpact: {
        bucket: 'private_sale',
        totalGainLossEur: '700.00',
        isTaxFree: true,
        reason: 'Haltefrist erfüllt (>1 Jahr)',
      },
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(detail),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      // "Ja" in Frei column for the lot
      expect(screen.getByText('Ja')).toBeInTheDocument();
    });
  });

  it('does not render FIFO lot table when lotConsumptions is empty', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail({ lotConsumptions: [] })),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Transaktionsdaten')).toBeInTheDocument();
    });

    expect(screen.queryByText(/FIFO Lot-Verbrauch/i)).not.toBeInTheDocument();
  });

  it('renders tax impact section with bucket and gain/loss', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Steuerliche Auswirkung')).toBeInTheDocument();
    });

    expect(screen.getByText('Steuerkorb')).toBeInTheDocument();
    // Bucket badge text
    expect(screen.getByText('Privates Veräußerungsgeschäft')).toBeInTheDocument();
    // Tax reason
    expect(screen.getByText('§23 EStG privates Veräußerungsgeschäft')).toBeInTheDocument();
  });

  it('renders Steuerfrei badge in tax impact when isTaxFree is true', async () => {
    const detail = makeDetail({
      taxImpact: {
        bucket: 'private_sale',
        totalGainLossEur: '700.00',
        isTaxFree: true,
        reason: 'Haltefrist erfüllt',
      },
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(detail),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText(/Steuerfrei \(Haltefrist\)/i)).toBeInTheDocument();
    });
  });

  it('renders futures_pnl bucket badge for futures transaction', async () => {
    const detail = makeDetail({
      transaction: makeTransaction({
        canonicalType: 'futures_close_long',
        side: null,
        symbol: 'BTCUSDT',
      }),
      futuresPosition: {
        realizedPnlEur: '1500.00',
        feeEur: '12.50',
      },
      taxImpact: {
        bucket: 'futures_pnl',
        totalGainLossEur: '1487.50',
        isTaxFree: false,
        reason: 'Futures P&L steuerpflichtig',
      },
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(detail),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Futures P&L')).toBeInTheDocument();
    });

    // Futures position section
    expect(screen.getByText('Futures Position')).toBeInTheDocument();
    expect(screen.getByText('Realisierter P&L')).toBeInTheDocument();
  });

  it('renders earn income section for earn transaction', async () => {
    const detail = makeDetail({
      transaction: makeTransaction({
        canonicalType: 'earn_interest',
        side: null,
        symbol: 'ETH',
      }),
      earnIncome: {
        amount: '0.05',
        eurValueAtReceipt: '90.00',
      },
      taxImpact: {
        bucket: 'staking_earn',
        totalGainLossEur: '90.00',
        isTaxFree: false,
        reason: '§22 EStG Einkünfte',
      },
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(detail),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Earn Einkommen')).toBeInTheDocument();
    });

    expect(screen.getByText('EUR Wert (Zufluss)')).toBeInTheDocument();
    expect(screen.getByText('Staking / Earn')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(
      <TransactionDetail
        {...defaultProps}
        transactionId={42}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Schließen')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Schließen'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    const { container } = render(
      <TransactionDetail
        {...defaultProps}
        transactionId={42}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.tx-detail-overlay')).toBeInTheDocument();
    });

    await userEvent.click(container.querySelector('.tx-detail-overlay')!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onNavigate(prev) when prev button is clicked', async () => {
    const onNavigate = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(
      <TransactionDetail
        {...defaultProps}
        transactionId={42}
        onNavigate={onNavigate}
        hasPrev={true}
        hasNext={false}
      />,
    );

    await userEvent.click(screen.getByLabelText('Vorherige Transaktion'));
    expect(onNavigate).toHaveBeenCalledWith('prev');
  });

  it('calls onNavigate(next) when next button is clicked', async () => {
    const onNavigate = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(
      <TransactionDetail
        {...defaultProps}
        transactionId={42}
        onNavigate={onNavigate}
        hasPrev={false}
        hasNext={true}
      />,
    );

    await userEvent.click(screen.getByLabelText('Nächste Transaktion'));
    expect(onNavigate).toHaveBeenCalledWith('next');
  });

  it('disables prev button when hasPrev is false', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(
      <TransactionDetail {...defaultProps} transactionId={42} hasPrev={false} />,
    );

    const prevBtn = screen.getByLabelText('Vorherige Transaktion');
    expect(prevBtn).toBeDisabled();
  });

  it('disables next button when hasNext is false', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(
      <TransactionDetail {...defaultProps} transactionId={42} hasNext={false} />,
    );

    const nextBtn = screen.getByLabelText('Nächste Transaktion');
    expect(nextBtn).toBeDisabled();
  });

  it('panel has aria-modal role dialog', () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    render(<TransactionDetail {...defaultProps} transactionId={42} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('re-fetches when transactionId changes', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeDetail()),
    } as Response);

    const { rerender } = render(
      <TransactionDetail {...defaultProps} transactionId={10} />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/transactions/10');
    });

    rerender(<TransactionDetail {...defaultProps} transactionId={20} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/transactions/20');
    });
  });
});
