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

interface SpotFuturesChartProps {
  data: YearSummaryResponse;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(26,35,50,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.8rem',
};

const LEGEND_STYLE: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.5)',
};

const SpotFuturesChart = ({ data }: SpotFuturesChartProps) => {
  const spotBucket = data.buckets.find((b) => b.bucket === 'private_sale');
  const futuresBucket = data.buckets.find((b) => b.bucket === 'futures_pnl');

  if (!spotBucket && !futuresBucket) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  const chartData = [
    {
      name: 'Netto P&L',
      Spot: spotBucket ? parseFloat(spotBucket.netEur) : 0,
      Futures: futuresBucket ? parseFloat(futuresBucket.netEur) : 0,
    },
    {
      name: 'Steuerpflichtig',
      Spot: spotBucket ? parseFloat(spotBucket.taxableAmountEur) : 0,
      Futures: futuresBucket ? parseFloat(futuresBucket.taxableAmountEur) : 0,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="name"
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
          formatter={(value, name) => [typeof value === 'number' ? formatEur(value) : String(value ?? ''), String(name ?? '')]}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="Spot" fill="#0070F2" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Futures" fill="#E9730C" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default SpotFuturesChart;
