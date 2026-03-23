import type { YearSummaryResponse } from '@cryptax/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  background: 'rgba(26,35,50,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.8rem',
};

const MonthlyBarChart = ({ data }: MonthlyBarChartProps) => {
  if (!data.monthlySpot.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  const chartData = data.monthlySpot.map((m) => ({
    month: m.month,
    gains: parseFloat(m.gains),
    losses: Math.abs(parseFloat(m.losses)),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatEur(v)}
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === 'number' ? formatEur(value) : String(value ?? ''),
            name === 'gains' ? 'Gewinne' : 'Verluste',
          ]}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
        />
        <Bar dataKey="gains" fill="#5fdc8a" name="gains" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="losses" fill="#E50000" name="losses" stackId="a" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default MonthlyBarChart;
