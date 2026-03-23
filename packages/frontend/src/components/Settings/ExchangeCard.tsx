import type { ExchangeConnection } from '@cryptax/shared';
import { useState } from 'react';
import GlassSurface from '../GlassSurface/GlassSurface';
import './ExchangeCard.css';

interface ExchangeCardProps {
  connection: ExchangeConnection;
  onDelete: (id: number) => void;
  onSync?: (id: number) => void;
}

const EXCHANGE_DISPLAY_NAMES: Record<string, string> = {
  bitget: 'Bitget',
};

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Noch nie synchronisiert';
  const date = new Date(lastSyncAt);
  return `Zuletzt synchronisiert: ${date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

const ExchangeCard = ({ connection, onDelete, onSync }: ExchangeCardProps) => {
  const [confirming, setConfirming] = useState(false);

  const exchangeName = EXCHANGE_DISPLAY_NAMES[connection.exchange] ?? connection.exchange;

  const handleDeleteClick = () => {
    setConfirming(true);
  };

  const handleConfirmDelete = () => {
    setConfirming(false);
    onDelete(connection.id);
  };

  const handleCancelDelete = () => {
    setConfirming(false);
  };

  return (
    <GlassSurface
      width="100%"
      height="auto"
      borderRadius={12}
      backgroundOpacity={0.6}
      className="exchange-card"
    >
      <div className="exchange-card__inner">
        <div className="exchange-card__info">
          <div className="exchange-card__header">
            <span className="exchange-card__exchange-badge">{exchangeName}</span>
            <span className="exchange-card__label">{connection.label}</span>
          </div>
          <p className="exchange-card__sync-time">{formatLastSync(connection.lastSyncAt)}</p>
        </div>

        <div className="exchange-card__actions">
          {onSync && (
            <button
              type="button"
              className="exchange-card__btn exchange-card__btn--sync"
              onClick={() => onSync(connection.id)}
              title="Synchronisieren"
              aria-label={`${connection.label} synchronisieren`}
            >
              Synchronisieren
            </button>
          )}

          {!confirming ? (
            <button
              type="button"
              className="exchange-card__btn exchange-card__btn--delete"
              onClick={handleDeleteClick}
              aria-label={`${connection.label} entfernen`}
            >
              Entfernen
            </button>
          ) : (
            <div className="exchange-card__confirm" role="alertdialog" aria-label="Bestätigung">
              <p className="exchange-card__confirm-text">
                Verbindung entfernen? Bereits importierte Trades bleiben erhalten.
              </p>
              <div className="exchange-card__confirm-actions">
                <button
                  type="button"
                  className="exchange-card__btn exchange-card__btn--cancel"
                  onClick={handleCancelDelete}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="exchange-card__btn exchange-card__btn--confirm-delete"
                  onClick={handleConfirmDelete}
                >
                  Entfernen
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
};

export default ExchangeCard;
