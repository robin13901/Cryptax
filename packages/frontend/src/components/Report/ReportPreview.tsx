import type { FuturesAppendixRow, ReportData, TradeAppendixRow } from '@cryptax/shared';
import { Fragment, useState } from 'react';
import { formatEur, formatNumber, gainLossColor } from '../../utils/format';
import GlassSurface from '../GlassSurface/GlassSurface';
import './ReportPreview.css';

interface ReportPreviewProps {
  data: ReportData;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function _formatDateDe(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function formatDateTimeDe(iso: string): string {
  const datePart = iso.slice(0, 10).split('-').reverse().join('.');
  const time = iso.slice(11, 16);
  return time && time !== '00:00' ? `${datePart} ${time}` : datePart;
}

// ---------------------------------------------------------------------------
// Grouping logic — sell groups from flat lot-consumption rows
// ---------------------------------------------------------------------------

interface SellGroup {
  sellTransactionId: number;
  symbol: string;
  sellDate: string;
  exchange: string;
  totalAmount: number;
  totalCostBasis: number;
  totalProceeds: number;
  totalGainLoss: number;
  allHaltefristMet: boolean;
  rows: TradeAppendixRow[];
}

function groupBySellTransaction(rows: TradeAppendixRow[]): SellGroup[] {
  const groups: SellGroup[] = [];
  let current: SellGroup | null = null;

  for (const row of rows) {
    if (!current || current.sellTransactionId !== row.sellTransactionId) {
      current = {
        sellTransactionId: row.sellTransactionId,
        symbol: row.symbol,
        sellDate: row.sellDate,
        exchange: row.exchange,
        totalAmount: 0,
        totalCostBasis: 0,
        totalProceeds: 0,
        totalGainLoss: 0,
        allHaltefristMet: true,
        rows: [],
      };
      groups.push(current);
    }
    current.totalAmount += parseFloat(row.amountConsumed);
    current.totalCostBasis += parseFloat(row.costBasisEur);
    current.totalProceeds += parseFloat(row.proceedsEur);
    current.totalGainLoss += parseFloat(row.gainLossEur);
    if (!row.haltefristMet) current.allHaltefristMet = false;
    current.rows.push(row);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function FreigrenzeStatus({ status }: { status: 'under' | 'over' }) {
  const isUnder = status === 'under';
  return (
    <span
      className={`freigrenze-status ${isUnder ? 'freigrenze-status--ok' : 'freigrenze-status--over'}`}
    >
      {isUnder ? 'eingehalten' : 'überschritten'}
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

function RichtungBadge({
  type,
}: {
  type: 'sell' | 'buy' | 'close-long' | 'close-short' | 'funding' | 'fee';
}) {
  const labels: Record<string, string> = {
    sell: 'Verkauf',
    buy: 'Kauf',
    'close-long': 'Close Long',
    'close-short': 'Close Short',
    funding: 'Funding',
    fee: 'Gebühr',
  };
  return <span className={`richtung-badge richtung-badge--${type}`}>{labels[type]}</span>;
}

// ---------------------------------------------------------------------------
// Trade appendix row components
// ---------------------------------------------------------------------------

function SellHeaderRow({
  group,
  expanded,
  onToggle,
}: {
  group: SellGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gl = group.totalGainLoss;
  const glColor = gainLossColor(gl);
  const kurs = group.totalAmount !== 0 ? group.totalProceeds / group.totalAmount : 0;

  return (
    <tr
      className={`trade-row trade-row--sell-header ${group.allHaltefristMet ? 'trade-row--taxfree' : ''}`}
      onClick={onToggle}
      data-testid="sell-header"
    >
      <td>
        <span className={`trade-row__chevron ${expanded ? 'trade-row__chevron--expanded' : ''}`}>
          &#x25B6;
        </span>
        {group.symbol}
      </td>
      <td>{formatDateTimeDe(group.sellDate)}</td>
      <td>
        <RichtungBadge type="sell" />
      </td>
      <td className="trade-cell--right">{formatEur(kurs)}</td>
      <td className="trade-cell--right">{formatNumber(group.totalAmount, 6)}</td>
      <td className="trade-cell--right">{formatEur(group.totalCostBasis)}</td>
      <td className="trade-cell--right">{formatEur(group.totalProceeds)}</td>
      <td className="trade-cell--right" style={{ color: glColor }}>
        {formatEur(gl, true)}
      </td>
      <td className="trade-cell--right">&mdash;</td>
      <td
        className={`trade-cell--center ${group.allHaltefristMet ? 'trade-cell--taxfree-label' : ''}`}
      >
        {group.allHaltefristMet ? 'Ja' : group.rows.some((r) => r.haltefristMet) ? 'Mix' : 'Nein'}
      </td>
    </tr>
  );
}

function BuySubRow({ row }: { row: TradeAppendixRow }) {
  const gl = parseFloat(row.gainLossEur);
  const glColor = gainLossColor(row.gainLossEur);
  const kurs =
    parseFloat(row.amountConsumed) !== 0
      ? parseFloat(row.costBasisEur) / parseFloat(row.amountConsumed)
      : 0;

  return (
    <tr
      className={`trade-row trade-row--buy-sub ${row.haltefristMet ? 'trade-row--taxfree' : ''}`}
      data-testid="buy-sub"
    >
      <td></td>
      <td>{formatDateTimeDe(row.buyDate)}</td>
      <td>
        <RichtungBadge type="buy" />
      </td>
      <td className="trade-cell--right">{formatEur(kurs)}</td>
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

// ---------------------------------------------------------------------------
// Futures appendix row
// ---------------------------------------------------------------------------

function directionBadgeType(direction: string): 'close-long' | 'close-short' | 'funding' | 'fee' {
  if (direction === 'Close Long') return 'close-long';
  if (direction === 'Close Short') return 'close-short';
  if (direction === 'Funding') return 'funding';
  return 'fee';
}

function FuturesRow({ row }: { row: FuturesAppendixRow }) {
  const pnlColor = gainLossColor(row.realizedPnlEur);
  return (
    <tr className="trade-row">
      <td>{row.symbol}</td>
      <td>{formatDateTimeDe(row.date)}</td>
      <td>
        <RichtungBadge type={directionBadgeType(row.direction)} />
      </td>
      <td className="trade-cell--right" style={{ color: pnlColor }}>
        {formatEur(row.realizedPnlEur, true)}
      </td>
      <td className="trade-cell--right">{formatEur(row.feeEur)}</td>
      <td>{row.exchange}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ReportPreview({ data }: ReportPreviewProps) {
  const {
    taxYear,
    generatedAt,
    spotSummary,
    futuresSummary,
    earnSummary,
    tradeAppendix,
    futuresAppendix,
  } = data;
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const groups = groupBySellTransaction(tradeAppendix);

  const toggleGroup = (sellTxId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sellTxId)) {
        next.delete(sellTxId);
      } else {
        next.add(sellTxId);
      }
      return next;
    });
  };

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
      <GlassSurface width="100%" height="auto" borderRadius={16}>
        <div className="report-section">
          <h3 className="report-section__title">
            Anlage SO &mdash; Private Veräußerungsgeschäfte (&sect;23 EStG)
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
            {spotSummary.tradeCount} Transaktionen (davon {spotSummary.taxFreeTradeCount} steuerfrei
            durch Haltefrist)
          </p>
        </div>
      </GlassSurface>

      {/* Anlage KAP — section 20 EStG */}
      <GlassSurface width="100%" height="auto" borderRadius={16}>
        <div className="report-section">
          <h3 className="report-section__title">
            Anlage KAP &mdash; Einkünfte aus Kapitalvermögen (&sect;20 EStG)
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
            <KeyValue label="Gebühren" value={formatEur(futuresSummary.totalFeesEur)} />
            <KeyValue
              label="Geschätzte Abgeltungssteuer"
              value={formatEur(futuresSummary.estimatedTaxEur)}
            />
          </div>
          <p className="report-section__footnote">25% + 5,5% Soli = 26,375%</p>
          <p className="report-section__meta">{futuresSummary.tradeCount} Positionen</p>
        </div>
      </GlassSurface>

      {/* Staking/Earn — section 22 Nr. 3 EStG */}
      <GlassSurface width="100%" height="auto" borderRadius={16}>
        <div className="report-section">
          <h3 className="report-section__title">
            Einkünfte aus Staking/Earn (&sect;22 Nr. 3 EStG)
          </h3>
          <div className="report-kv-grid">
            <KeyValue label="Gesamteinkommen" value={formatEur(earnSummary.totalIncomeEur)} />
            <KeyValue
              label="Freigrenze (§22 EStG)"
              value={formatEur(earnSummary.freigrenzeLimitEur)}
            />
          </div>
          <div className="report-freigrenze-row">
            <span className="report-freigrenze-row__label">Freigrenze-Status:</span>
            <FreigrenzeStatus status={earnSummary.freigrenzeStatus} />
          </div>
          <p className="report-section__meta">{earnSummary.recordCount} Earn-Einträge</p>
          {earnSummary.perCoinBreakdown.length > 0 && (
            <div className="report-earn-breakdown">
              <h4 className="report-earn-breakdown__title">Aufschlüsselung je Coin</h4>
              <table className="report-earn-table">
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="trade-cell--right">EUR Wert</th>
                    <th className="trade-cell--right">Einträge</th>
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

      {/* Trade appendix — Spot (collapsible groups) */}
      <GlassSurface width="100%" height="auto" borderRadius={16}>
        <div className="report-section">
          <h3 className="report-section__title">
            Handelsanhang &mdash; Spot-Transaktionen ({groups.length} Verkäufe)
          </h3>
          <div className="report-trade-table-wrapper">
            <table className="report-trade-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Datum</th>
                  <th>Richtung</th>
                  <th className="trade-cell--right">Kurs</th>
                  <th className="trade-cell--right">Menge</th>
                  <th className="trade-cell--right">Einstandswert</th>
                  <th className="trade-cell--right">Erlös</th>
                  <th className="trade-cell--right">G/V</th>
                  <th className="trade-cell--right">Tage</th>
                  <th className="trade-cell--center">Haltefrist</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const isExpanded = expandedGroups.has(group.sellTransactionId);
                  return (
                    <Fragment key={group.sellTransactionId}>
                      <SellHeaderRow
                        group={group}
                        expanded={isExpanded}
                        onToggle={() => toggleGroup(group.sellTransactionId)}
                      />
                      {isExpanded && group.rows.map((row) => <BuySubRow key={row.id} row={row} />)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {tradeAppendix.length === 0 && (
            <p className="report-section__meta">Keine Spot-Trades für dieses Jahr.</p>
          )}
        </div>
      </GlassSurface>

      {/* Futures appendix */}
      {futuresAppendix.length > 0 && (
        <GlassSurface width="100%" height="auto" borderRadius={16}>
          <div className="report-section">
            <h3 className="report-section__title">
              Handelsanhang &mdash; Futures-Positionen ({futuresAppendix.length})
            </h3>
            <div className="report-trade-table-wrapper">
              <table className="report-trade-table report-futures-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Datum</th>
                    <th>Richtung</th>
                    <th className="trade-cell--right">Realisierter G/V</th>
                    <th className="trade-cell--right">Gebühr</th>
                    <th>Börse</th>
                  </tr>
                </thead>
                <tbody>
                  {futuresAppendix.map((row) => (
                    <FuturesRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </GlassSurface>
      )}
    </div>
  );
}

export default ReportPreview;
