import type { SyncResult } from '@cryptax/shared';
import './SyncProgress.css';

interface SyncProgressProps {
  syncing: boolean;
  result?: SyncResult | null;
  error?: string | null;
}

const SyncProgress = ({ syncing, result, error }: SyncProgressProps) => {
  if (syncing) {
    return (
      <div className="sync-progress sync-progress--syncing" aria-live="polite" aria-label="Synchronisierung laeuft">
        <span className="sync-progress__spinner" aria-hidden="true" />
        <span className="sync-progress__text">Synchronisiere...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sync-progress sync-progress--error" aria-live="polite" aria-label="Synchronisierungsfehler">
        <span className="sync-progress__icon sync-progress__icon--error" aria-hidden="true">✕</span>
        <span className="sync-progress__text">{error}</span>
      </div>
    );
  }

  if (result) {
    return (
      <div className="sync-progress sync-progress--done" aria-live="polite" aria-label="Synchronisierung abgeschlossen">
        <span className="sync-progress__icon sync-progress__icon--done" aria-hidden="true">✓</span>
        <span className="sync-progress__text">
          {result.totalImported} importiert, {result.totalDuplicates} Duplikate
        </span>
      </div>
    );
  }

  return null;
};

export default SyncProgress;
