import type { PriceStatusResponse } from '@cryptax/shared';
import { useCallback, useEffect, useState } from 'react';
import GlassSurface from '../GlassSurface/GlassSurface';
import './PriceStatus.css';

// ---------------------------------------------------------------------------
// Source badge labels
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  'csv-fill': 'CSV',
  'bitget-direct': 'Bitget',
  'bitget-usdt': 'Bitget/USDT',
  coingecko: 'CoinGecko',
  manual: 'Manuell',
};

const FAILURE_LABELS: Record<string, string> = {
  'no-bitget-pair': 'Kein Bitget-Paar',
  'no-coingecko-id': 'Kein CoinGecko-ID',
  'api-error': 'API-Fehler',
  'out-of-range': 'Außerhalb Bereich',
  unknown: 'Unbekannt',
};

// ---------------------------------------------------------------------------
// PriceStatus component
// ---------------------------------------------------------------------------

interface PriceStatusProps {
  /** Called after enrichment completes so parent can refresh other data. */
  onEnrichmentComplete?: () => void;
}

type EnrichStatus = 'idle' | 'running' | 'done' | 'error';

function PriceStatus({ onEnrichmentComplete }: PriceStatusProps) {
  const [status, setStatus] = useState<PriceStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus>('idle');
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [unresolvedExpanded, setUnresolvedExpanded] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch status
  // -------------------------------------------------------------------------
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/prices/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PriceStatusResponse;
      setStatus(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Fehler beim Laden des Status');
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // -------------------------------------------------------------------------
  // Trigger enrichment
  // -------------------------------------------------------------------------
  const handleEnrich = async () => {
    if (enrichStatus === 'running') return;

    setEnrichStatus('running');
    setEnrichError(null);

    try {
      const res = await fetch('/api/prices/enrich', { method: 'POST' });
      if (res.status === 409) {
        setEnrichError('Anreicherung läuft bereits');
        setEnrichStatus('error');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setEnrichStatus('done');
      await fetchStatus();
      onEnrichmentComplete?.();
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Fehler bei der Anreicherung');
      setEnrichStatus('error');
    }
  };

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const total = status?.total ?? 0;
  const resolved = status?.resolved ?? 0;
  const unresolved = status?.unresolved ?? 0;
  const progressPct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  const hasUnresolved = unresolved > 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <GlassSurface width="auto" height="auto" borderRadius={14} backgroundOpacity={0.06}>
      <div className="price-status">
        {/* Header */}
        <div className="price-status__header">
          <h3 className="price-status__title">EUR-Preise</h3>
          <button
            type="button"
            className={`price-status__enrich-btn ${enrichStatus === 'running' ? 'price-status__enrich-btn--running' : ''}`}
            onClick={handleEnrich}
            disabled={enrichStatus === 'running'}
            aria-label="EUR-Preise auflösen"
          >
            {enrichStatus === 'running' ? 'Wird ausgeführt…' : 'Preise auflösen'}
          </button>
        </div>

        {/* Load error */}
        {loadError && (
          <div className="price-status__alert price-status__alert--error">{loadError}</div>
        )}

        {/* Enrich error */}
        {enrichError && (
          <div className="price-status__alert price-status__alert--error">{enrichError}</div>
        )}

        {/* Enrich success */}
        {enrichStatus === 'done' && !enrichError && (
          <div className="price-status__alert price-status__alert--success">
            Anreicherung abgeschlossen.
          </div>
        )}

        {/* Unresolved warning banner */}
        {hasUnresolved && (
          <div className="price-status__alert price-status__alert--warning">
            {unresolved} Transaktion{unresolved !== 1 ? 'en' : ''} ohne EUR-Preis
          </div>
        )}

        {/* Progress bar */}
        <div className="price-status__progress-section">
          <div className="price-status__progress-label">
            <span>
              {resolved} von {total} aufgelöst
            </span>
            <span className="price-status__progress-pct">{progressPct}%</span>
          </div>
          <div className="price-status__progress-track">
            <div
              className="price-status__progress-fill"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {/* Source breakdown badges */}
        {status && Object.keys(status.bySource).length > 0 && (
          <div className="price-status__sources">
            <span className="price-status__section-label">Quellen</span>
            <div className="price-status__badge-row">
              {Object.entries(status.bySource).map(([source, cnt]) => (
                <span key={source} className={`price-status__badge price-status__badge--${source}`}>
                  {SOURCE_LABELS[source] ?? source}: {cnt}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Failure breakdown */}
        {status && Object.keys(status.failureBreakdown).length > 0 && (
          <div className="price-status__failures">
            <span className="price-status__section-label">Fehler</span>
            <div className="price-status__badge-row">
              {Object.entries(status.failureBreakdown).map(([reason, cnt]) => (
                <span key={reason} className="price-status__badge price-status__badge--failure">
                  {FAILURE_LABELS[reason] ?? reason}: {cnt}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Unresolved transaction list (collapsible) */}
        {status && status.unresolvedTransactions.length > 0 && (
          <div className="price-status__unresolved">
            <button
              type="button"
              className="price-status__unresolved-toggle"
              onClick={() => setUnresolvedExpanded((v) => !v)}
              aria-expanded={unresolvedExpanded}
            >
              Nicht aufgelöste Transaktionen ({status.unresolvedTransactions.length})
              <span className="price-status__unresolved-arrow">
                {unresolvedExpanded ? '▲' : '▼'}
              </span>
            </button>

            {unresolvedExpanded && (
              <div className="price-status__unresolved-list">
                {status.unresolvedTransactions.map((tx) => (
                  <div key={tx.id} className="price-status__unresolved-row">
                    <span className="price-status__unresolved-symbol">{tx.symbol}</span>
                    <span className="price-status__unresolved-date">
                      {tx.tradedAt.slice(0, 10)}
                    </span>
                    <span className="price-status__unresolved-reason">
                      {FAILURE_LABELS[tx.failureReason ?? ''] ?? tx.failureReason ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </GlassSurface>
  );
}

export default PriceStatus;
