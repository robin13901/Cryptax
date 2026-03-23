import type { YearSummaryResponse } from '@cryptax/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatEur } from '../../../utils/format';

interface GainLossBarChartProps {
  data: YearSummaryResponse;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(26,35,50,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.8rem',
};

const GainLossBarChart = ({ data }: GainLossBarChartProps) => {
  if (!data.perCoinGainLoss.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  // Sort by absolute value descending, take top 10
  const chartData = [...data.perCoinGainLoss]
    .sort((a, b) => Math.abs(parseFloat(b.net)) - Math.abs(parseFloat(a.net)))
    .slice(0, 10)
    .map((c) => ({
      symbol: c.symbol,
      net: parseFloat(c.net),
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="symbol"
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
          formatter={(value) => [typeof value === 'number' ? formatEur(value, true) : String(value ?? ''), 'Netto']}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
        />
        <Bar dataKey="net" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.net >= 0 ? '#5fdc8a' : '#E50000'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default GainLossBarChart;
