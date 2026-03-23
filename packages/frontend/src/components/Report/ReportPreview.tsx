import type { ReportData, TradeAppendixRow } from '@cryptax/shared';
import { formatEur, formatNumber, gainLossColor } from '../../utils/format';
import GlassSurface from '../GlassSurface/GlassSurface';
import './ReportPreview.css';

interface ReportPreviewProps {
  data: ReportData;
}

function formatDateDe(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function FreigrenzeStatus({ status }: { status: 'under' | 'over' }) {
  const isUnder = status === 'under';
  return (
    <span
      className={`freigrenze-status ${isUnder ? 'freigrenze-status--ok' : 'freigrenze-status--over'}`}
    >
      {isUnder ? 'eingehalten' : 'ueberschritten'}
    </span>
  );
}

function KeyValue({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="report-kv">
      <span className="report-kv__label">{label}</span>
      <span className="report-kv__value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function TradeRow({ row, index }: { row: TradeAppendixRow; index: number }) {
  const gl = parseFloat(row.gainLossEur);
  const glColor = gainLossColor(row.gainLossEur);
  return (
    <tr className={`trade-row ${index % 2 === 0 ? 'trade-row--even' : ''} ${row.haltefristMet ? 'trade-row--taxfree' : ''}`}>
      <td>{row.symbol}</td>
      <td>{formatDateDe(row.buyDate)}</td>
      <td>{formatDateDe(row.sellDate)}</td>
      <td className="trade-cell--right">{formatNumber(row.amountConsumed, 6)}</td>
      <td className="trade-cell--right">{formatEur(row.costBasisEur)}</td>
      <td className="trade-cell--right">{formatEur(row.proceedsEur)}</td>
      <td className="trade-cell--right" style={{ color: glColor }}>
        {formatEur(gl, true)}
      </td>
      <td className="trade-cell--right">{row.heldDays}</td>
      <td className={`trade-cell--center ${row.haltefristMet ? 'trade-cell--taxfree-label' : ''}`}>
        {row.haltefristMet ? 'Ja' : 'Nein'}
      </td>
    </tr>
  );
}

function ReportPreview({ data }: ReportPreviewProps) {
  const { taxYear, generatedAt, spotSummary, futuresSummary, earnSummary, tradeAppendix } = data;

  const generatedDate = new Date(generatedAt).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="report-preview">
      {/* Report header */}
      <div className="report-preview__header">
        <h2 className="report-preview__title">Krypto-Steuerreport {taxYear}</h2>
        <p className="report-preview__meta">Erstellt am: {generatedDate}</p>
      </div>

      {/* Anlage SO — section 23 EStG */}
      <GlassSurface width="100%" height="auto" borderRadius={16} backgroundOpacity={0.05}>
        <div className="report-section">
          <h3 className="report-section__title">
            Anlage SO &mdash; Private Veraeusserungsgeschaefte (&sect;23 EStG)
          </h3>
          <div className="report-kv-grid">
            <KeyValue label="Gesamtgewinn" value={formatEur(spotSummary.totalGainsEur)} />
            <KeyValue
              label="Gesamtverlust"
              value={formatEur(spotSummary.totalLossesEur)}
              color={gainLossColor(spotSummary.totalLossesEur)}
            />
            <KeyValue
              label="Netto"
              value={formatEur(spotSummary.netEur, true)}
              color={gainLossColor(spotSummary.netEur)}
            />
            <KeyValue
              label="Steuerpflichtiger Betrag"
              value={formatEur(spotSummary.taxableAmountEur)}
            />
            <KeyValue
              label="Freigrenze (§23 EStG)"
              value={formatEur(spotSummary.freigrenzeLimitEur)}
            />
          </div>
          <div className="report-freigrenze-row">
            <span className="report-freigrenze-row__label">Freigrenze-Status:</span>
            <FreigrenzeStatus status={spotSummary.freigrenzeStatus} />
          </div>
          <p className="report-section__meta">
            {spotSummary.tradeCount} Transaktionen (davon {spotSummary.taxFreeTradeCount}{' '}
            steuerfrei durch Haltefrist)
          </p>
        </div>
      </GlassSurface>

      {/* Anlage KAP — section 20 EStG */}
      <GlassSurface width="100%" height="auto" borderRadius={16} backgroundOpacity={0.05}>
        <div className="report-section">
          <h3 className="report-section__title">
            Anlage KAP &mdash; Einkuenfte aus Kapitalvermoegen (&sect;20 EStG)
          </h3>
          <div className="report-kv-grid">
            <KeyValue label="Gesamtgewinn" value={formatEur(futuresSummary.totalGainsEur)} />
            <KeyValue
              label="Gesamtverlust"
              value={formatEur(futuresSummary.totalLossesEur)}
              color={gainLossColor(futuresSummary.totalLossesEur)}
            />
            <KeyValue
              label="Netto"
              value={formatEur(futuresSummary.netEur, true)}
              color={gainLossColor(futuresSummary.netEur)}
            />
            <KeyValue label="Gebuehren" value={formatEur(futuresSummary.totalFeesEur)} />
            <KeyValue
              label="Geschaetzte Abgeltungssteuer"
              value={formatEur(futuresSummary.estimatedTaxEur)}
            />
          </div>
          <p className="report-section__footnote">25% + 5,5% Soli = 26,375%</p>
          <p className="report-section__meta">{futuresSummary.tradeCount} Positionen</p>
        </div>
      </GlassSurface>

      {/* Staking/Earn — section 22 Nr. 3 EStG */}
      <GlassSurface width="100%" height="auto" borderRadius={16} backgroundOpacity={0.05}>
        <div className="report-section">
          <h3 className="report-section__title">
            Einkuenfte aus Staking/Earn (&sect;22 Nr. 3 EStG)
          </h3>
          <div className="report-kv-grid">
            <KeyValue
              label="Gesamteinkommen"
              value={formatEur(earnSummary.totalIncomeEur)}
            />
            <KeyValue
              label="Freigrenze (§22 EStG)"
              value={formatEur(earnSummary.freigrenzeLimitEur)}
            />
          </div>
          <div className="report-freigrenze-row">
            <span className="report-freigrenze-row__label">Freigrenze-Status:</span>
            <FreigrenzeStatus status={earnSummary.freigrenzeStatus} />
          </div>
          <p className="report-section__meta">{earnSummary.recordCount} Earn-Eintraege</p>
          {earnSummary.perCoinBreakdown.length > 0 && (
            <div className="report-earn-breakdown">
              <h4 className="report-earn-breakdown__title">Aufschluesselung je Coin</h4>
              <table className="report-earn-table">
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="trade-cell--right">EUR Wert</th>
                    <th className="trade-cell--right">Eintraege</th>
                  </tr>
                </thead>
                <tbody>
                  {earnSummary.perCoinBreakdown.map((coin) => (
                    <tr key={coin.symbol}>
                      <td>{coin.symbol}</td>
                      <td className="trade-cell--right">{formatEur(coin.totalEur)}</td>
                      <td className="trade-cell--right">{coin.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassSurface>

      {/* Trade appendix */}
      <GlassSurface width="100%" height="auto" borderRadius={16} backgroundOpacity={0.05}>
        <div className="report-section">
          <h3 className="report-section__title">
            Handelsanhang &mdash; Alle Transaktionen ({tradeAppendix.length})
          </h3>
          <div className="report-trade-table-wrapper">
            <table className="report-trade-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Kaufdatum</th>
                  <th>Verkaufdatum</th>
                  <th className="trade-cell--right">Menge</th>
                  <th className="trade-cell--right">Einstandswert</th>
                  <th className="trade-cell--right">Erloes</th>
                  <th className="trade-cell--right">G/V</th>
                  <th className="trade-cell--right">Tage</th>
                  <th className="trade-cell--center">Haltefrist</th>
                </tr>
              </thead>
              <tbody>
                {tradeAppendix.map((row, i) => (
                  <TradeRow key={row.id} row={row} index={i} />
                ))}
              </tbody>
            </table>
          </div>
          {tradeAppendix.length === 0 && (
            <p className="report-section__meta">Keine Trades fuer dieses Jahr.</p>
          )}
        </div>
      </GlassSurface>
    </div>
  );
}

export default ReportPreview;
