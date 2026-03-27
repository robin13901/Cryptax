import type { YearSummaryResponse } from '@cryptax/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatEur } from '../../../utils/format';

interface MonthlyBarChartProps {
  data: YearSummaryResponse;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.78rem',
  padding: '0.5rem 0.75rem',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};

const MonthlyBarChart = ({ data }: MonthlyBarChartProps) => {
  // Merge spot gains/losses + futures P&L into monthly buckets
  const monthlyGains = new Map<string, number>();
  const monthlyLosses = new Map<string, number>();

  for (const m of data.monthlySpot) {
    monthlyGains.set(m.month, (monthlyGains.get(m.month) ?? 0) + parseFloat(m.gains));
    monthlyLosses.set(m.month, (monthlyLosses.get(m.month) ?? 0) + Math.abs(parseFloat(m.losses)));
  }
  for (const m of data.monthlyFutures) {
    const pnl = parseFloat(m.pnl);
    if (pnl >= 0) {
      monthlyGains.set(m.month, (monthlyGains.get(m.month) ?? 0) + pnl);
    } else {
      monthlyLosses.set(m.month, (monthlyLosses.get(m.month) ?? 0) + Math.abs(pnl));
    }
  }

  const allMonths = new Set([...monthlyGains.keys(), ...monthlyLosses.keys()]);
  if (allMonths.size === 0) {
    return (
      <div
        style={{
          height: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.25)',
          fontSize: '0.85rem',
        }}
      >
        Keine Daten
      </div>
    );
  }

  const chartData = Array.from(allMonths)
    .sort()
    .map((month) => ({
      month: month.slice(5),
      Gewinne: monthlyGains.get(month) ?? 0,
      Verluste: monthlyLosses.get(month) ?? 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatEur(v)}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === 'number' ? formatEur(value) : String(value ?? ''),
            String(name ?? ''),
          ]}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
        />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.72rem' }}>{value}</span>
          )}
          iconSize={8}
          wrapperStyle={{ paddingTop: 4 }}
        />
        <Bar
          dataKey="Gewinne"
          fill="#5fdc8a"
          fillOpacity={0.85}
          radius={[0, 0, 0, 0]}
          stackId="stack"
          maxBarSize={28}
        />
        <Bar
          dataKey="Verluste"
          fill="#e55c5c"
          fillOpacity={0.85}
          radius={[3, 3, 0, 0]}
          stackId="stack"
          maxBarSize={28}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default MonthlyBarChart;
