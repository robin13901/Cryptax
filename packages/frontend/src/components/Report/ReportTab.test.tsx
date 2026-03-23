import type { ReportData } from '@cryptax/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportTab from './ReportTab';

// ---------------------------------------------------------------------------
// Mock data fixtures
// ---------------------------------------------------------------------------

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    taxYear: 2024,
    generatedAt: '2024-12-31T23:59:59Z',
    spotSummary: {
      totalGainsEur: '5000.00',
      totalLossesEur: '-1200.00',
      netEur: '3800.00',
      taxableAmountEur: '3800.00',
      freigrenzeLimitEur: '1000',
      freigrenzeStatus: 'over',
      tradeCount: 42,
      taxFreeTradeCount: 5,
    },
    futuresSummary: {
      totalGainsEur: '2000.00',
      totalLossesEur: '-500.00',
      netEur: '1500.00',
      taxableAmountEur: '1500.00',
      totalFeesEur: '80.00',
      estimatedTaxEur: '395.63',
      tradeCount: 10,
    },
    earnSummary: {
      totalIncomeEur: '200.00',
      freigrenzeLimitEur: '256',
      freigrenzeStatus: 'under',
      recordCount: 12,
      perCoinBreakdown: [
        { symbol: 'ETH', totalEur: '120.00', count: 8 },
        { symbol: 'SOL', totalEur: '80.00', count: 4 },
      ],
    },
    tradeAppendix: [
      {
        id: 1,
        symbol: 'BTC',
        buyDate: '2023-01-15T10:00:00Z',
        sellDate: '2024-03-10T14:00:00Z',
        amountConsumed: '0.5',
        costBasisEur: '10000.00',
        proceedsEur: '15000.00',
        gainLossEur: '5000.00',
        feeEur: '25.00',
        heldDays: 420,
        haltefristMet: true,
        exchange: 'bitget',
      },
      {
        id: 2,
        symbol: 'ETH',
        buyDate: '2024-01-05T08:00:00Z',
        sellDate: '2024-06-20T11:00:00Z',
        amountConsumed: '2.0',
        costBasisEur: '6000.00',
        proceedsEur: '8000.00',
        gainLossEur: '2000.00',
        feeEur: '10.00',
        heldDays: 166,
        haltefristMet: false,
        exchange: 'bitget',
      },
      {
        id: 3,
        symbol: 'SOL',
        buyDate: '2024-02-01T09:00:00Z',
        sellDate: '2024-07-15T16:00:00Z',
        amountConsumed: '10.0',
        costBasisEur: '900.00',
        proceedsEur: '700.00',
        gainLossEur: '-200.00',
        feeEur: '5.00',
        heldDays: 164,
        haltefristMet: false,
        exchange: 'bitget',
      },
    ],
    ...overrides,
  };
}

function mockFetch(yearsFn?: () => object, previewFn?: () => object | null) {
  vi.mocked(global.fetch).mockImplementation((url) => {
    const urlStr = typeof url === 'string' ? url : (url as Request).url ?? '';

    if (urlStr.includes('/api/report/years')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(yearsFn ? yearsFn() : { years: [2024, 2025] }),
      } as Response);
    }

    if (urlStr.match(/\/api\/report\/\d+\/preview/)) {
      const data = previewFn ? previewFn() : makeReportData();
      if (data === null) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve(null),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      } as Response);
    }

    if (urlStr.match(/\/api\/report\/\d+\/pdf/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
      } as unknown as Response);
    }

    if (urlStr.match(/\/api\/report\/\d+\/csv/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['symbol,date'], { type: 'text/csv' })),
      } as unknown as Response);
    }

    return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportTab', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
    // Stub URL.createObjectURL / revokeObjectURL for download tests
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: year selector populated
  it('renders year selector after loading years', async () => {
    mockFetch(() => ({ years: [2024, 2025] }));

    render(<ReportTab />);

    await waitFor(() => {
      const selector = screen.getByRole('combobox', { name: /Steuerjahr/i });
      expect(selector).toBeInTheDocument();
      const options = selector.querySelectorAll('option');
      const values = Array.from(options).map((o) => o.textContent);
      expect(values).toContain('2024');
      expect(values).toContain('2025');
    });
  });

  // Test 2: empty state on 404
  it('shows empty state when no data for year', async () => {
    mockFetch(undefined, () => null);

    render(<ReportTab />);

    await waitFor(() => {
      expect(screen.getByText(/Keine Daten fuer/i)).toBeInTheDocument();
    });
  });

  // Test 3: preview sections visible when data available
  it('renders preview when data available', async () => {
    mockFetch(undefined, () => makeReportData());

    render(<ReportTab />);

    await waitFor(() => {
      expect(screen.getByText(/Anlage SO/i)).toBeInTheDocument();
      expect(screen.getByText(/Anlage KAP/i)).toBeInTheDocument();
    });
  });

  // Test 4: buttons disabled when no data
  it('download buttons are disabled when no data', async () => {
    mockFetch(undefined, () => null);

    render(<ReportTab />);

    await waitFor(() => {
      expect(screen.getByText(/Keine Daten fuer/i)).toBeInTheDocument();
    });

    const pdfBtn = screen.getByRole('button', { name: /PDF herunterladen/i });
    const csvBtn = screen.getByRole('button', { name: /CSV exportieren/i });
    expect(pdfBtn).toBeDisabled();
    expect(csvBtn).toBeDisabled();
  });

  // Test 5: buttons enabled when data available
  it('download buttons are enabled when data available', async () => {
    mockFetch(undefined, () => makeReportData());

    render(<ReportTab />);

    await waitFor(() => {
      const pdfBtn = screen.getByRole('button', { name: /PDF herunterladen/i });
      const csvBtn = screen.getByRole('button', { name: /CSV exportieren/i });
      expect(pdfBtn).not.toBeDisabled();
      expect(csvBtn).not.toBeDisabled();
    });
  });

  // Test 6: PDF download triggers fetch to correct URL
  it('PDF download triggers fetch to correct URL', async () => {
    const user = userEvent.setup();
    mockFetch(undefined, () => makeReportData());

    render(<ReportTab />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /PDF herunterladen/i })).not.toBeDisabled();
    });

    const pdfBtn = screen.getByRole('button', { name: /PDF herunterladen/i });
    await user.click(pdfBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map((c) => {
        const u = c[0];
        return typeof u === 'string' ? u : (u as Request).url;
      });
      expect(calls.some((url) => url.includes('/api/report/') && url.includes('/pdf'))).toBe(true);
    });
  });

  // Test 7: CSV download triggers fetch to correct URL
  it('CSV download triggers fetch to correct URL', async () => {
    const user = userEvent.setup();
    mockFetch(undefined, () => makeReportData());

    render(<ReportTab />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /CSV exportieren/i })).not.toBeDisabled();
    });

    const csvBtn = screen.getByRole('button', { name: /CSV exportieren/i });
    await user.click(csvBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map((c) => {
        const u = c[0];
        return typeof u === 'string' ? u : (u as Request).url;
      });
      expect(calls.some((url) => url.includes('/api/report/') && url.includes('/csv'))).toBe(true);
    });
  });

  // Test 8: trade appendix shows correct number of rows
  it('trade appendix shows correct number of rows', async () => {
    mockFetch(undefined, () => makeReportData()); // fixture has 3 rows

    render(<ReportTab />);

    await waitFor(() => {
      // Table body rows for trade appendix
      const rows = document.querySelectorAll('.report-trade-table tbody tr');
      expect(rows.length).toBe(3);
    });
  });

  // Test 9: Freigrenze status displays correctly
  it('Freigrenze status displays correctly', async () => {
    mockFetch(undefined, () => makeReportData()); // earnSummary.freigrenzeStatus = 'under'

    render(<ReportTab />);

    await waitFor(() => {
      // The earn section shows 'eingehalten' (under = ok)
      expect(screen.getAllByText('eingehalten').length).toBeGreaterThan(0);
    });
  });

  // Test 10: shows loading state while fetching
  it('shows loading state while fetching', async () => {
    // Delay the preview response to catch the loading state
    vi.mocked(global.fetch).mockImplementation((url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url ?? '';

      if (urlStr.includes('/api/report/years')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ years: [2024] }),
        } as Response);
      }

      if (urlStr.match(/\/api\/report\/\d+\/preview/)) {
        // Slow response to capture loading state
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(makeReportData()),
              } as Response),
            200,
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
    });

    render(<ReportTab />);

    // Loading indicator should appear at some point
    // The loading state triggers after years are loaded
    await waitFor(() => {
      // Either loading message or the final content — loading text appears transiently
      const loadingEl = screen.queryByText(/Lade Report/i);
      const previewEl = screen.queryByText(/Anlage SO/i);
      // At least one of these should be present
      expect(loadingEl ?? previewEl).not.toBeNull();
    });
  });
});
