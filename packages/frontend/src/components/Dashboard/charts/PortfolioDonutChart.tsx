import type { YearSummaryResponse } from '@cryptax/shared';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatEur } from '../../../utils/format';

interface PortfolioDonutChartProps {
  data: YearSummaryResponse;
}

const COLORS = [
  '#0070F2', // crypto blue
  '#5fdc8a', // crypto green
  '#4d9de0', // light blue
  '#354A5F', // crypto navy
  '#3ba8a8', // teal
  '#2a6cb8', // mid blue
  '#7ec8a0', // muted green
  '#5b8ab5', // steel blue
];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.78rem',
  padding: '0.5rem 0.75rem',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};

const RADIAN = Math.PI / 180;

const renderLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  name,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  name: string;
  percent: number;
}) => {
  if (percent < 0.04) return null; // Skip tiny slices
  const radius = innerRadius + (outerRadius - innerRadius) * 1.35;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="rgba(255,255,255,0.6)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={500}
    >
      {name}
    </text>
  );
};

const PortfolioDonutChart = ({ data }: PortfolioDonutChartProps) => {
  if (!data.portfolioAllocation.length) {
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

  // Group small allocations into "Andere"
  const sorted = [...data.portfolioAllocation]
    .map((p) => ({ name: p.symbol, value: parseFloat(p.valueEur) }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = sorted.reduce((acc, p) => acc + p.value, 0);
  const threshold = total * 0.02;
  const major = sorted.filter((p) => p.value >= threshold);
  const minor = sorted.filter((p) => p.value < threshold);
  const otherValue = minor.reduce((acc, p) => acc + p.value, 0);

  const chartData = [...major.slice(0, 7)];
  if (otherValue > 0) {
    chartData.push({ name: 'Andere', value: otherValue });
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="50%"
          outerRadius="75%"
          paddingAngle={2}
          label={renderLabel}
          labelLine={false}
        >
          {chartData.map((_entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
              stroke="rgba(15,23,42,0.8)"
              strokeWidth={1}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [
            typeof value === 'number' ? formatEur(value) : String(value ?? ''),
            'Wert',
          ]}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
        />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.72rem' }}>{value}</span>
          )}
          iconSize={8}
          wrapperStyle={{ paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default PortfolioDonutChart;
