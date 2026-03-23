import type { YearSummaryResponse } from '@cryptax/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

// ---------------------------------------------------------------------------
// Mock data fixture
// ---------------------------------------------------------------------------

function makeYearSummary(overrides: Partial<YearSummaryResponse> = {}): YearSummaryResponse {
  return {
    taxYear: 2024,
    availableYears: [2023, 2024],
    engineHasRun: true,
    buckets: [
      {
        bucket: 'private_sale',
        totalGainsEur: '5000.00',
        totalLossesEur: '-1200.00',
        netEur: '3800.00',
        taxableAmountEur: '3800.00',
        estimatedTaxEur: '0.00',
        tradeCount: 42,
      },
      {
        bucket: 'futures_pnl',
        totalGainsEur: '2000.00',
        totalLossesEur: '-500.00',
        netEur: '1500.00',
        taxableAmountEur: '1500.00',
        estimatedTaxEur: '395.63',
        tradeCount: 10,
      },
      {
        bucket: 'staking_earn',
        totalGainsEur: '350.00',
        totalLossesEur: '0.00',
        netEur: '350.00',
        taxableAmountEur: '350.00',
        estimatedTaxEur: '0.00',
        tradeCount: 8,
      },
    ],
    totalNetEur: '5650.00',
    totalTradeCount: 60,
    totalTaxableEur: '5300.00',
    totalEstimatedTaxEur: '395.63',
    monthlySpot: [
      { month: '2024-01', gains: '1000.00', losses: '-300.00' },
      { month: '2024-02', gains: '2000.00', losses: '-400.00' },
    ],
    monthlyFutures: [
      { month: '2024-01', pnl: '500.00' },
      { month: '2024-02', pnl: '-200.00' },
    ],
    perCoinGainLoss: [
      { symbol: 'BTC', net: '3000.00' },
      { symbol: 'ETH', net: '800.00' },
    ],
    portfolioAllocation: [
      { symbol: 'BTC', valueEur: '15000.00' },
      { symbol: 'ETH', valueEur: '4000.00' },
    ],
    yearOverYear: [
      { taxYear: 2023, spotNet: '1200.00', futuresNet: '300.00', earnNet: '80.00' },
      { taxYear: 2024, spotNet: '3800.00', futuresNet: '1500.00', earnNet: '350.00' },
    ],
    spotFreigrenzeEur: '1000',
    earnFreigrenzeEur: '256',
    spotNetForFreigrenze: '800.00',
    earnTotalForFreigrenze: '150.00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows empty state message when engineHasRun is false', async () => {
    const noEngineData = makeYearSummary({ engineHasRun: false });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(noEngineData),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(/Steuer-Engine noch nicht ausgefuehrt/i),
      ).toBeInTheDocument();
    });
  });

  it('does not show empty state when engineHasRun is true', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      expect(
        screen.queryByText(/Steuer-Engine noch nicht ausgefuehrt/i),
      ).not.toBeInTheDocument();
    });
  });

  it('renders 4 KPI cards with correct labels when data is loaded', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Gesamtgewinn')).toBeInTheDocument();
    });

    expect(screen.getByText('Trades')).toBeInTheDocument();
    expect(screen.getByText('Steuerpflichtig')).toBeInTheDocument();
    expect(screen.getByText('Steuer (est.)')).toBeInTheDocument();
  });

  it('displays the total trade count from mock data', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      // totalTradeCount = 60
      expect(screen.getByText('60')).toBeInTheDocument();
    });
  });

  it('renders YearSelector with available years', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      // YearSelector renders a <select> with year options
      const selector = screen.getByRole('combobox', { name: /Steuerjahr/i });
      expect(selector).toBeInTheDocument();
    });

    const selector = screen.getByRole('combobox', { name: /Steuerjahr/i });
    // Should contain year options
    const options = selector.querySelectorAll('option');
    const yearValues = Array.from(options).map((o) => o.textContent);
    expect(yearValues).toContain('2024');
    expect(yearValues).toContain('2023');
  });

  it('makes fetch call to /api/summary/{year}', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // First call should be to some year summary endpoint
    const firstCallUrl = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(firstCallUrl).toMatch(/\/api\/summary\/\d+/);
  });

  it('renders FreigrenzeBar when engine has run', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    const { container } = render(<Dashboard />);

    await waitFor(() => {
      // FreigrenzeBar renders a section with freigrenze-related content
      expect(container.querySelector('.dashboard__freigrenze')).toBeInTheDocument();
    });
  });

  it('does not render FreigrenzeBar when engine has not run', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary({ engineHasRun: false })),
    } as Response);

    const { container } = render(<Dashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(/Steuer-Engine noch nicht ausgefuehrt/i),
      ).toBeInTheDocument();
    });

    expect(container.querySelector('.dashboard__freigrenze')).not.toBeInTheDocument();
  });

  it('changes year when YearSelector is changed', async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeYearSummary()),
    } as Response);

    render(<Dashboard />);

    // Wait for initial data and year selector to render with options
    await waitFor(() => {
      const selector = screen.getByRole('combobox', { name: /Steuerjahr/i });
      const options = selector.querySelectorAll('option');
      expect(options.length).toBeGreaterThan(1);
    });

    const selector = screen.getByRole('combobox', { name: /Steuerjahr/i });

    // Select year 2023
    await user.selectOptions(selector, '2023');

    // Fetch should eventually be called for year 2023
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('/api/summary/2023'))).toBe(true);
    });
  });
});
