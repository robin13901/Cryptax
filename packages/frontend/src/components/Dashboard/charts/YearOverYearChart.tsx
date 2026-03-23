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

interface YearOverYearChartProps {
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

const YearOverYearChart = ({ data }: YearOverYearChartProps) => {
  if (!data.yearOverYear.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  const chartData = data.yearOverYear.map((y) => ({
    year: String(y.taxYear),
    Spot: parseFloat(y.spotNet),
    Futures: parseFloat(y.futuresNet),
    Earn: parseFloat(y.earnNet),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="year"
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
        <Bar dataKey="Earn" fill="#5fdc8a" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default YearOverYearChart;
