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
  background: 'rgba(15, 23, 42, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.78rem',
  padding: '0.5rem 0.75rem',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};

const YearOverYearChart = ({ data }: YearOverYearChartProps) => {
  if (!data.yearOverYear.length) {
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

  const chartData = data.yearOverYear.map((y) => ({
    year: String(y.taxYear),
    Spot: parseFloat(y.spotNet),
    Futures: parseFloat(y.futuresNet),
    Earn: parseFloat(y.earnNet),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
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
          dataKey="Spot"
          fill="#0070F2"
          fillOpacity={0.85}
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        />
        <Bar
          dataKey="Futures"
          fill="#5fdc8a"
          fillOpacity={0.85}
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        />
        <Bar
          dataKey="Earn"
          fill="#3ba8a8"
          fillOpacity={0.85}
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default YearOverYearChart;
