import type { ExchangeConnection } from '@cryptax/shared';
import { useEffect, useState } from 'react';
import GlassSurface from '../GlassSurface/GlassSurface';
import CredentialForm from './CredentialForm';
import ExchangeCard from './ExchangeCard';
import PasswordChange from './PasswordChange';
import './SettingsTab.css';

interface SettingsTabProps {
  onLogout: () => void;
}

const SettingsTab = ({ onLogout }: SettingsTabProps) => {
  const [connections, setConnections] = useState<ExchangeConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetch('/api/exchanges')
      .then((res) => res.json<ExchangeConnection[]>())
      .then((data) => {
        setConnections(data);
      })
      .catch(() => {
        // Keep empty list on error
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleSave = (newConnection: ExchangeConnection) => {
    setConnections((prev) => [...prev, newConnection]);
    setShowForm(false);
  };

  const handleDelete = (id: number) => {
    fetch(`/api/exchanges/${id}`, { method: 'DELETE' })
      .then(() => {
        setConnections((prev) => prev.filter((c) => c.id !== id));
      })
      .catch(() => {
        // Leave list unchanged on error
      });
  };

  const handleSyncAll = () => {
    // Placeholder — wired in 07-07
  };

  return (
    <div className="settings-tab">
      {/* Section 1: Exchange connections */}
      <section className="settings-tab__section" aria-label="Boersenverbindungen">
        <div className="settings-tab__section-header">
          <h2 className="settings-tab__section-title">Boersenverbindungen</h2>
          <div className="settings-tab__section-actions">
            {connections.length > 0 && (
              <button
                type="button"
                className="settings-tab__btn settings-tab__btn--sync-all"
                onClick={handleSyncAll}
              >
                Alle synchronisieren
              </button>
            )}
            <button
              type="button"
              className="settings-tab__btn settings-tab__btn--add"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? 'Abbrechen' : '+ Verbindung hinzufuegen'}
            </button>
          </div>
        </div>

        {showForm && (
          <GlassSurface
            width="100%"
            height="auto"
            borderRadius={12}
            backgroundOpacity={0.6}
            className="settings-tab__form-surface"
          >
            <div className="settings-tab__form-inner">
              <h3 className="settings-tab__form-title">Bitget verbinden</h3>
              <CredentialForm
                onSave={handleSave}
                onCancel={() => setShowForm(false)}
              />
            </div>
          </GlassSurface>
        )}

        {loading ? (
          <p className="settings-tab__loading">Lade Verbindungen...</p>
        ) : connections.length === 0 && !showForm ? (
          <div className="settings-tab__empty">
            <p className="settings-tab__empty-text">
              Keine Exchange-Verbindungen konfiguriert. Fuege eine Verbindung hinzu, um Trades
              automatisch zu importieren.
            </p>
          </div>
        ) : (
          <div className="settings-tab__connection-list">
            {connections.map((conn) => (
              <ExchangeCard key={conn.id} connection={conn} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: App settings */}
      <section className="settings-tab__section" aria-label="App-Einstellungen">
        <div className="settings-tab__section-header">
          <h2 className="settings-tab__section-title">App-Einstellungen</h2>
        </div>

        <GlassSurface
          width="100%"
          height="auto"
          borderRadius={12}
          backgroundOpacity={0.6}
          className="settings-tab__app-settings-surface"
        >
          <div className="settings-tab__app-settings-inner">
            <h3 className="settings-tab__subsection-title">Passwort aendern</h3>
            <PasswordChange onLogout={onLogout} />
          </div>
        </GlassSurface>
      </section>
    </div>
  );
};

export default SettingsTab;
