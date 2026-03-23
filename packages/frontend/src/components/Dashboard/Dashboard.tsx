import type { YearSummaryResponse } from '@cryptax/shared';
import { useEffect, useState } from 'react';
import { FreigrenzeBar } from './FreigrenzeBar';
import { KpiCards } from './KpiCards';
import { YearSelector } from './YearSelector';
import ChartCard from './charts/ChartCard';
import GainLossBarChart from './charts/GainLossBarChart';
import MonthlyBarChart from './charts/MonthlyBarChart';
import PnlLineChart from './charts/PnlLineChart';
import PortfolioDonutChart from './charts/PortfolioDonutChart';
import SpotFuturesChart from './charts/SpotFuturesChart';
import YearOverYearChart from './charts/YearOverYearChart';
import './Dashboard.css';

function Dashboard() {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [data, setData] = useState<YearSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch summary data whenever selectedYear changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/summary/${selectedYear}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<YearSummaryResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);

        // Auto-select most recent year if we just loaded the default year
        const years = json.availableYears ?? [];
        setAvailableYears(years);

        if (years.length > 0) {
          const mostRecent = Math.max(...years);
          if (selectedYear === new Date().getFullYear() && mostRecent !== selectedYear) {
            setSelectedYear(mostRecent);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  const engineHasRun = data?.engineHasRun ?? false;

  const spotCurrent = data ? parseFloat(data.spotNetForFreigrenze) : 0;
  const spotLimit = data ? parseFloat(data.spotFreigrenzeEur) : 1000;
  const earnCurrent = data ? parseFloat(data.earnTotalForFreigrenze) : 0;
  const earnLimit = data ? parseFloat(data.earnFreigrenzeEur) : 256;

  return (
    <div className="dashboard">
      {/* Year selector row */}
      <div className="dashboard__header">
        <YearSelector
          years={availableYears}
          selected={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      {/* KPI cards */}
      <KpiCards data={data} loading={loading} />

      {/* Freigrenze bar */}
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

      {/* Empty state shown when engine has not run */}
      {!engineHasRun && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">&#9881;</div>
          <p>Steuer-Engine noch nicht ausgefuehrt</p>
          <p style={{ fontSize: '0.78rem' }}>
            Importiere Transaktionen und fuehre die Steuer-Engine aus, um Ergebnisse zu sehen.
          </p>
        </div>
      )}

      {/* Chart grid — rendered when engine has run and data is available */}
      {engineHasRun && data !== null && (
        <div className="dashboard__charts">
          <ChartCard title="P&L Entwicklung (kumulativ)" className="chart-card--wide">
            <PnlLineChart data={data} />
          </ChartCard>

          <ChartCard title="Portfolio Verteilung">
            <PortfolioDonutChart data={data} />
          </ChartCard>

          <ChartCard title="Gewinn / Verlust je Coin (Top 10)">
            <GainLossBarChart data={data} />
          </ChartCard>

          <ChartCard title="Monatliche Performance (Spot)">
            <MonthlyBarChart data={data} />
          </ChartCard>

          <ChartCard title="Spot vs. Futures">
            <SpotFuturesChart data={data} />
          </ChartCard>

          <ChartCard title="Jahresvergleich">
            <YearOverYearChart data={data} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
