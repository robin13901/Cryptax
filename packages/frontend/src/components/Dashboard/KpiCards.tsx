import type { YearSummaryResponse } from '@cryptax/shared';
import GlassSurface from '../GlassSurface/GlassSurface';
import { formatEur, gainLossColor } from '../../utils/format';

interface KpiCardsProps {
  data: YearSummaryResponse | null;
  loading: boolean;
}

export function KpiCards({ data, loading }: KpiCardsProps) {
  const blank = loading || data === null;

  const gesamtgewinn = blank ? '--' : formatEur(data.totalNetEur, true);
  const gesamtgewinnColor = blank ? undefined : gainLossColor(data.totalNetEur);

  const trades = blank ? '--' : String(data.totalTradeCount);

  const steuerpflichtig = blank ? '--' : formatEur(data.totalTaxableEur);

  const steuer = blank ? '--' : formatEur(data.totalEstimatedTaxEur);

  return (
    <div className="kpi-grid">
      <GlassSurface width="auto" height="auto" borderRadius={10} backgroundOpacity={0.12}>
        <div className="kpi-card">
          <span className="kpi-value" style={{ color: gesamtgewinnColor }}>
            {gesamtgewinn}
          </span>
          <span className="kpi-label">Gesamtgewinn</span>
          <span className="kpi-sub">{data ? `${data.taxYear}` : 'Jahr'}</span>
        </div>
      </GlassSurface>

      <GlassSurface width="auto" height="auto" borderRadius={10} backgroundOpacity={0.12}>
        <div className="kpi-card">
          <span className="kpi-value">{trades}</span>
          <span className="kpi-label">Trades</span>
          <span className="kpi-sub">Gesamt</span>
        </div>
      </GlassSurface>

      <GlassSurface width="auto" height="auto" borderRadius={10} backgroundOpacity={0.12}>
        <div className="kpi-card">
          <span className="kpi-value">{steuerpflichtig}</span>
          <span className="kpi-label">Steuerpflichtig</span>
          <span className="kpi-sub">Spot + Futures</span>
        </div>
      </GlassSurface>

      <GlassSurface width="auto" height="auto" borderRadius={10} backgroundOpacity={0.12}>
        <div className="kpi-card">
          <span className="kpi-value">{steuer}</span>
          <span className="kpi-label">Steuer (est.)</span>
          <span className="kpi-sub">Abgeltungssteuer</span>
        </div>
      </GlassSurface>
    </div>
  );
}
