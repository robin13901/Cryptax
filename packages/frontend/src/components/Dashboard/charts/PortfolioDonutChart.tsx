import type { YearSummaryResponse } from '@cryptax/shared';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatEur } from '../../../utils/format';

interface PortfolioDonutChartProps {
  data: YearSummaryResponse;
}

const COLORS = [
  '#0070F2',
  '#5fdc8a',
  '#E9730C',
  '#E50000',
  '#a78bfa',
  '#38bdf8',
  '#f472b6',
  '#facc15',
];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(26,35,50,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '0.8rem',
};

const PortfolioDonutChart = ({ data }: PortfolioDonutChartProps) => {
  if (!data.portfolioAllocation.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
        Keine Daten
      </div>
    );
  }

  const chartData = data.portfolioAllocation.map((p) => ({
    name: p.symbol,
    value: parseFloat(p.valueEur),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
        >
          {chartData.map((_entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [typeof value === 'number' ? formatEur(value) : String(value ?? ''), 'Wert']}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default PortfolioDonutChart;
