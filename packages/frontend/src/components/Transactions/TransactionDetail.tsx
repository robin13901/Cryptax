import type { TransactionDetailResponse } from '@cryptax/shared';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { formatEur, formatNumber, gainLossColor } from '../../utils/format';
import './TransactionDetail.css';

interface TransactionDetailProps {
  transactionId: number | null;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  hasPrev: boolean;
  hasNext: boolean;
}

function BucketBadge({ bucket }: { bucket: TransactionDetailResponse['taxImpact']['bucket'] }) {
  const label =
    bucket === 'private_sale'
      ? 'Privates Veräußerungsgeschäft'
      : bucket === 'futures_pnl'
        ? 'Futures P&L'
        : bucket === 'staking_earn'
          ? 'Staking / Earn'
          : 'Kein Steuerbuckets';
  const cls = `tx-detail-bucket tx-detail-bucket--${bucket ?? 'null'}`;
  return <span className={cls}>{label}</span>;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

const TransactionDetail = ({
  transactionId,
  onClose,
  onNavigate,
  hasPrev,
  hasNext,
}: TransactionDetailProps) => {
  const [detail, setDetail] = useState<TransactionDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (transactionId === null) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);

    fetch(`/api/transactions/${transactionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<TransactionDetailResponse>;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        // silently ignore — panel shows empty
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const tx = detail?.transaction;
  const lots = detail?.lotConsumptions ?? [];
  const futures = detail?.futuresPosition ?? null;
  const earn = detail?.earnIncome ?? null;
  const taxImpact = detail?.taxImpact;

  const summaryLine = tx
    ? `${tx.symbol} · ${tx.canonicalType} · ${formatDate(tx.tradedAt)}`
    : 'Lade…';

  return (
    <>
      {/* Semi-transparent overlay */}
      <motion.div
        key="tx-detail-overlay"
        className="tx-detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in panel */}
      <motion.div
        key="tx-detail-panel"
        className="tx-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Transaktionsdetails"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="tx-detail-header">
          <button
            type="button"
            className="tx-detail-nav-btn"
            aria-label="Vorherige Transaktion"
            disabled={!hasPrev}
            onClick={() => onNavigate('prev')}
          >
            ‹
          </button>
          <button
            type="button"
            className="tx-detail-nav-btn"
            aria-label="Nächste Transaktion"
            disabled={!hasNext}
            onClick={() => onNavigate('next')}
          >
            ›
          </button>
          <span className="tx-detail-title">{summaryLine}</span>
          <button
            type="button"
            className="tx-detail-close-btn"
            aria-label="Schließen"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="tx-detail-body">
          {loading && (
            <div className="tx-detail-loading">
              <span className="tx-detail-loading-spinner" />
              Lade Transaktionsdetails…
            </div>
          )}

          {!loading && tx && (
            <>
              {/* Transaction fields */}
              <section className="tx-detail-section">
                <h3 className="tx-detail-section-title">Transaktionsdaten</h3>
                <dl className="tx-detail-dl">
                  <dt className="tx-detail-dt">ID</dt>
                  <dd className="tx-detail-dd">{tx.id}</dd>

                  <dt className="tx-detail-dt">Datum</dt>
                  <dd className="tx-detail-dd">{formatDate(tx.tradedAt)}</dd>

                  <dt className="tx-detail-dt">Symbol</dt>
                  <dd className="tx-detail-dd">{tx.symbol}</dd>

                  <dt className="tx-detail-dt">Typ</dt>
                  <dd className="tx-detail-dd">{tx.canonicalType}</dd>

                  <dt className="tx-detail-dt">Seite</dt>
                  <dd className="tx-detail-dd">{tx.side ?? '--'}</dd>

                  <dt className="tx-detail-dt">Menge</dt>
                  <dd className="tx-detail-dd">{formatNumber(tx.amount, 8)}</dd>

                  {tx.price != null && (
                    <>
                      <dt className="tx-detail-dt">Preis</dt>
                      <dd className="tx-detail-dd">{formatNumber(tx.price, 6)}</dd>
                    </>
                  )}

                  {tx.eurPrice != null && (
                    <>
                      <dt className="tx-detail-dt">EUR Preis</dt>
                      <dd className="tx-detail-dd">{formatEur(tx.eurPrice)}</dd>
                    </>
                  )}

                  <dt className="tx-detail-dt">Gebühr</dt>
                  <dd className="tx-detail-dd">{formatEur(tx.fee)}</dd>

                  {tx.totalValue != null && (
                    <>
                      <dt className="tx-detail-dt">Gesamtwert</dt>
                      <dd className="tx-detail-dd">{formatEur(tx.totalValue)}</dd>
                    </>
                  )}

                  <dt className="tx-detail-dt">Steuerjahr</dt>
                  <dd className="tx-detail-dd">{tx.taxYear}</dd>

                  <dt className="tx-detail-dt">Exchange</dt>
                  <dd className="tx-detail-dd">{tx.exchange}</dd>

                  <dt className="tx-detail-dt">Preisquelle</dt>
                  <dd className="tx-detail-dd">{tx.priceSource ?? '--'}</dd>

                  {tx.orderId && (
                    <>
                      <dt className="tx-detail-dt">Order-ID</dt>
                      <dd className="tx-detail-dd">{tx.orderId}</dd>
                    </>
                  )}
                </dl>
              </section>

              {/* FIFO lot consumptions */}
              {lots.length > 0 && (
                <section className="tx-detail-section">
                  <h3 className="tx-detail-section-title">FIFO Lot-Verbrauch ({lots.length})</h3>
                  <div className="tx-detail-lot-table-wrapper">
                    <table className="tx-detail-lot-table" aria-label="FIFO Lots">
                      <thead>
                        <tr>
                          <th>Kaufdatum</th>
                          <th>Menge</th>
                          <th>Einstand</th>
                          <th>Erlös</th>
                          <th>G/V</th>
                          <th>Tage</th>
                          <th>Frei</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lots.map((lot) => {
                          const gv = parseFloat(lot.gainLossEur);
                          const gvClass = gv > 0 ? 'gain' : gv < 0 ? 'loss' : '';
                          return (
                            <tr key={lot.lotId}>
                              <td>{formatDate(lot.acquiredAt).slice(0, 10)}</td>
                              <td>{formatNumber(lot.amountConsumed, 6)}</td>
                              <td>{formatEur(lot.costBasisEur)}</td>
                              <td>{formatEur(lot.proceedsEur)}</td>
                              <td className={gvClass}>{formatEur(lot.gainLossEur, true)}</td>
                              <td>{lot.heldDays}</td>
                              <td>
                                {lot.haltefristMet && (
                                  <span className="tx-detail-lot-exempt">Ja</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Futures position */}
              {futures !== null && (
                <section className="tx-detail-section">
                  <h3 className="tx-detail-section-title">Futures Position</h3>
                  <dl className="tx-detail-dl">
                    <dt className="tx-detail-dt">Realisierter P&L</dt>
                    <dd
                      className="tx-detail-dd"
                      style={{ color: gainLossColor(futures.realizedPnlEur) }}
                    >
                      {formatEur(futures.realizedPnlEur, true)}
                    </dd>

                    <dt className="tx-detail-dt">Gebühr</dt>
                    <dd className="tx-detail-dd">{formatEur(futures.feeEur)}</dd>
                  </dl>
                </section>
              )}

              {/* Earn income */}
              {earn !== null && (
                <section className="tx-detail-section">
                  <h3 className="tx-detail-section-title">Earn Einkommen</h3>
                  <dl className="tx-detail-dl">
                    <dt className="tx-detail-dt">Betrag</dt>
                    <dd className="tx-detail-dd">{formatNumber(earn.amount, 8)}</dd>

                    <dt className="tx-detail-dt">EUR Wert (Zufluss)</dt>
                    <dd className="tx-detail-dd">{formatEur(earn.eurValueAtReceipt)}</dd>
                  </dl>
                </section>
              )}

              {/* Tax impact */}
              {taxImpact && (
                <section className="tx-detail-section">
                  <h3 className="tx-detail-section-title">Steuerliche Auswirkung</h3>
                  <div className="tx-detail-tax-impact">
                    <div className="tx-detail-tax-row">
                      <span className="tx-detail-tax-label">Steuerkorb</span>
                      <BucketBadge bucket={taxImpact.bucket} />
                    </div>

                    <div className="tx-detail-tax-row">
                      <span className="tx-detail-tax-label">Gewinn / Verlust</span>
                      <span
                        className="tx-detail-tax-value tx-detail-tax-value--total"
                        style={{ color: gainLossColor(taxImpact.totalGainLossEur) }}
                      >
                        {formatEur(taxImpact.totalGainLossEur, true)}
                      </span>
                    </div>

                    {taxImpact.isTaxFree && (
                      <div className="tx-detail-tax-row">
                        <span className="tx-detail-tax-label">Steuerfrei</span>
                        <span className="tx-detail-taxfree-badge">Steuerfrei (Haltefrist)</span>
                      </div>
                    )}

                    <p className="tx-detail-reason">{taxImpact.reason}</p>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </motion.div>
    </>
  );
};

export default TransactionDetail;
