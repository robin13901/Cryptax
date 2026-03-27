import type { YearSummaryResponse } from '@cryptax/shared';
import { formatEur, gainLossColor } from '../../utils/format';
import './KpiCards.css';

interface KpiCardsProps {
  data: YearSummaryResponse | null;
  loading: boolean;
}

interface KpiCardDef {
  label: string;
  value: string;
  color?: string;
  sub: string;
  accent?: string;
}

export function KpiCards({ data, loading }: KpiCardsProps) {
  const blank = loading || data === null;

  const cards: KpiCardDef[] = [
    {
      label: 'Gesamtgewinn',
      value: blank ? '--' : formatEur(data.totalNetEur, true),
      color: blank ? undefined : gainLossColor(data.totalNetEur),
      sub: data ? `${data.taxYear}` : 'Jahr',
      accent: blank
        ? undefined
        : parseFloat(data.totalNetEur) >= 0
          ? 'var(--accent-green)'
          : 'var(--accent-red)',
    },
    {
      label: 'Trades',
      value: blank ? '--' : data.totalTradeCount.toLocaleString('de-DE'),
      sub: 'Gesamt',
      accent: 'var(--accent-blue)',
    },
    {
      label: 'Steuerpflichtig',
      value: blank ? '--' : formatEur(data.totalTaxableEur),
      sub: 'Spot + Futures',
      accent: 'var(--accent-amber)',
    },
    {
      label: 'Steuer (est.)',
      value: blank ? '--' : formatEur(data.totalEstimatedTaxEur),
      sub: 'Abgeltungssteuer',
      accent: 'var(--accent-purple)',
    },
  ];

  return (
    <div className="kpi-grid">
      {cards.map((card) => (
        <div
          key={card.label}
          className="kpi-card"
          style={card.accent ? ({ '--kpi-accent': card.accent } as React.CSSProperties) : undefined}
        >
          <div className="kpi-card__accent-bar" />
          <span className="kpi-label">{card.label}</span>
          <span className="kpi-value" style={card.color ? { color: card.color } : undefined}>
            {card.value}
          </span>
          <span className="kpi-sub">{card.sub}</span>
        </div>
      ))}
    </div>
  );
}
