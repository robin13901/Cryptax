import type { YearSummaryResponse } from '@cryptax/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
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
  background: 'rgba(15, 23, 42, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.78rem',
  padding: '0.5rem 0.75rem',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};

const PnlLineChart = ({ data }: PnlLineChartProps) => {
  if (!data.dailyPnl.length) {
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

  let cumulative = 0;
  const rawData = data.dailyPnl.map((d) => {
    cumulative += parseFloat(d.net);
    return {
      date: d.date.slice(5), // "MM-DD"
      pnl: parseFloat(cumulative.toFixed(2)),
    };
  });

  // 30-day simple moving average
  const SMA_WINDOW = 30;
  const chartData = rawData.map((point, i) => {
    if (i < SMA_WINDOW - 1) return point;
    let sum = 0;
    for (let j = i - SMA_WINDOW + 1; j <= i; j++) {
      sum += rawData[j].pnl;
    }
    return { ...point, sma30: parseFloat((sum / SMA_WINDOW).toFixed(2)) };
  });

  const isPositive = chartData.length > 0 && (chartData[chartData.length - 1]?.pnl ?? 0) >= 0;
  const strokeColor = isPositive ? '#5fdc8a' : '#e55c5c';
  const gradientId = 'pnlGradient';

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v: number) => formatEur(v)}
          tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip
          labelFormatter={(label) => `${data.taxYear}-${label}`}
          formatter={(value: number, name: string) => [
            formatEur(value, true),
            name === 'sma30' ? '30d SMA' : 'Kumulativ',
          ]}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}
          cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <Area
          type="monotone"
          dataKey="pnl"
          stroke={strokeColor}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: strokeColor, stroke: 'rgba(15,23,42,0.8)', strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="sma30"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          activeDot={{ r: 3, fill: 'rgba(255,255,255,0.6)' }}
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default PnlLineChart;
