import GlassSurface from '../GlassSurface/GlassSurface';
import './FreigrenzeBar.css';

interface FreigrenzeBarProps {
  spotCurrent: number;
  spotLimit: number;
  earnCurrent: number;
  earnLimit: number;
}

function barColor(pct: number): string {
  if (pct >= 90) return 'var(--freigrenze-red)';
  if (pct >= 70) return 'var(--freigrenze-amber)';
  return 'var(--freigrenze-green)';
}

function formatEurSimple(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

interface SingleBarProps {
  label: string;
  sublabel: string;
  current: number;
  limit: number;
}

function SingleBar({ label, sublabel, current, limit }: SingleBarProps) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const color = barColor(pct);
  const exceeded = current > limit;

  return (
    <div className="freigrenze-bar-item">
      <div className="freigrenze-bar-header">
        <span className="freigrenze-bar-label">
          {label} <span className="freigrenze-bar-sublabel">{sublabel}</span>
        </span>
        <span className="freigrenze-bar-amounts" style={{ color }}>
          {formatEurSimple(current)} / {formatEurSimple(limit)}
        </span>
      </div>
      <div
        className="freigrenze-bar-track"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label} Freigrenze: ${formatEurSimple(current)} von ${formatEurSimple(limit)}`}
      >
        <div
          className="freigrenze-bar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {exceeded && (
        <p className="freigrenze-bar-warning">
          Freigrenze uberschritten! Gewinne sind steuerpflichtig.
        </p>
      )}
    </div>
  );
}

export function FreigrenzeBar({ spotCurrent, spotLimit, earnCurrent, earnLimit }: FreigrenzeBarProps) {
  return (
    <GlassSurface width="100%" height="auto" borderRadius={10} backgroundOpacity={0.1}>
      <div className="freigrenze-container">
        <h3 className="freigrenze-title">Freigrenze-Status</h3>
        <div className="freigrenze-bars">
          <SingleBar
            label="Spot"
            sublabel="§23 EStG"
            current={spotCurrent}
            limit={spotLimit}
          />
          <SingleBar
            label="Earn"
            sublabel="§22 EStG"
            current={earnCurrent}
            limit={earnLimit}
          />
        </div>
      </div>
    </GlassSurface>
  );
}
