import type { YearSummaryResponse } from '@cryptax/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import ChartCard from './charts/ChartCard';
import GainLossBarChart from './charts/GainLossBarChart';
import MonthlyBarChart from './charts/MonthlyBarChart';
import PnlLineChart from './charts/PnlLineChart';
import PortfolioDonutChart from './charts/PortfolioDonutChart';
import SpotFuturesChart from './charts/SpotFuturesChart';
import YearOverYearChart from './charts/YearOverYearChart';
import { FreigrenzeBar } from './FreigrenzeBar';
import { KpiCards } from './KpiCards';
import { YearSelector } from './YearSelector';
import './Dashboard.css';

const POLL_INTERVAL_MS = 3000;

interface DashboardProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
}

function Dashboard({ selectedYear, onYearChange }: DashboardProps) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [data, setData] = useState<YearSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const lastComputedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialFetchDone = useRef(false);

  const fetchSummary = useCallback(
    async (year: number) => {
      try {
        const res = await fetch(`/api/summary/${year}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as YearSummaryResponse;

        const newComputedAt = json.computedAt ?? null;
        if (newComputedAt !== lastComputedRef.current || !initialFetchDone.current) {
          lastComputedRef.current = newComputedAt;
          initialFetchDone.current = true;
          setData(json);

          const years = json.availableYears ?? [];
          setAvailableYears(years);

          if (years.length > 0) {
            const mostRecent = Math.max(...years);
            if (year === new Date().getFullYear() && mostRecent !== year) {
              onYearChange(mostRecent);
            }
          }
        }
      } catch {
        // Keep showing stale data on poll failures
      } finally {
        setLoading(false);
      }
    },
    [onYearChange]
  );

  useEffect(() => {
    setLoading(true);
    lastComputedRef.current = null;
    initialFetchDone.current = false;
    void fetchSummary(selectedYear);
  }, [selectedYear, fetchSummary]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      void fetchSummary(selectedYear);
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [selectedYear, fetchSummary]);

  const engineHasRun = data?.engineHasRun ?? false;

  const spotCurrent = data ? parseFloat(data.spotNetForFreigrenze) : 0;
  const spotLimit = data ? parseFloat(data.spotFreigrenzeEur) : 1000;
  const earnCurrent = data ? parseFloat(data.earnTotalForFreigrenze) : 0;
  const earnLimit = data ? parseFloat(data.earnFreigrenzeEur) : 256;

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <YearSelector years={availableYears} selected={selectedYear} onChange={onYearChange} />
      </div>

      <KpiCards data={data} loading={loading} />

      {engineHasRun && data !== null && (
        <div className="dashboard__freigrenze">
          <FreigrenzeBar
            spotCurrent={spotCurrent}
            spotLimit={spotLimit}
            earnCurrent={earnCurrent}
            earnLimit={earnLimit}
          />
        </div>
      )}

      {!engineHasRun && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">&#9881;</div>
          <p>Berechnung läuft oder keine Transaktionen vorhanden</p>
          <p style={{ fontSize: '0.78rem' }}>
            Importiere Transaktionen und löse Preise auf — die Steuerberechnung startet automatisch.
          </p>
        </div>
      )}

      {engineHasRun && data !== null && (
        <div className="dashboard__charts">
          {/* Row 1: P&L line — full width */}
          <ChartCard title="P&L Entwicklung (kumulativ)" className="chart-card--wide">
            <PnlLineChart data={data} />
          </ChartCard>

          {/* Row 2: Monthly + Gain/Loss per coin — 50/50 */}
          <ChartCard title="Monatliche Performance (Spot)">
            <MonthlyBarChart data={data} />
          </ChartCard>

          <ChartCard title="Gewinn / Verlust je Coin (Top 10)">
            <GainLossBarChart data={data} />
          </ChartCard>

          {/* Row 3: Portfolio + Spot vs Futures + Year over Year — thirds */}
          <ChartCard title="Portfolio Verteilung" className="chart-card--third">
            <PortfolioDonutChart data={data} />
          </ChartCard>

          <ChartCard title="Spot vs. Futures" className="chart-card--third">
            <SpotFuturesChart data={data} />
          </ChartCard>

          <ChartCard title="Jahresvergleich" className="chart-card--third">
            <YearOverYearChart data={data} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
