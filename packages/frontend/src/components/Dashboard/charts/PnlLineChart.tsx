import type { YearSummaryResponse } from '@cryptax/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatEur } from '../../../utils/format';

interface PnlLineChartProps {
  data: YearSummaryResponse;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(26,35,50,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.8rem',
};

const PnlLineChart = ({ data }: PnlLineChartProps) => {
  if (!data.monthlySpot.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  // Build cumulative P&L from monthlySpot
  let cumulative = 0;
  const chartData = data.monthlySpot.map((m) => {
    const gains = parseFloat(m.gains);
    const losses = parseFloat(m.losses);
    cumulative += gains + losses; // losses are stored as negative values
    return {
      month: m.month,
      pnl: parseFloat(cumulative.toFixed(2)),
    };
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
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
          formatter={(value) => [typeof value === 'number' ? formatEur(value) : String(value ?? ''), 'Kumulativer Gewinn']}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
        />
        <Line
          type="monotone"
          dataKey="pnl"
          stroke="#5fdc8a"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#5fdc8a' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default PnlLineChart;
