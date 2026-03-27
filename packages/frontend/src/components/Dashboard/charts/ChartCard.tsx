import './ChartCard.css';

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

const ChartCard = ({ title, children, className = '' }: ChartCardProps) => {
  return (
    <div className={`chart-card ${className}`}>
      <div className="chart-card__title">{title}</div>
      <div className="chart-card__body">{children}</div>
    </div>
  );
};

export default ChartCard;
