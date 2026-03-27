import type { ExchangeConnection, SyncResult } from '@cryptax/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import GlassSurface from '../GlassSurface/GlassSurface';
import CredentialForm from './CredentialForm';
import ExchangeCard from './ExchangeCard';
import PasswordChange from './PasswordChange';
import './SettingsTab.css';

interface SettingsTabProps {
  onLogout: () => void;
}

interface SyncState {
  syncing: boolean;
  result: SyncResult | null;
  error: string | null;
}

const SettingsTab = ({ onLogout }: SettingsTabProps) => {
  const [connections, setConnections] = useState<ExchangeConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Map from connection id to sync state
  const [syncStates, setSyncStates] = useState<Record<number, SyncState>>({});
  const [syncingAll, setSyncingAll] = useState(false);

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
        setSyncStates((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      })
      .catch(() => {
        // Leave list unchanged on error
      });
  };

  const handleSync = (id: number) => {
    setSyncStates((prev) => ({
      ...prev,
      [id]: { syncing: true, result: null, error: null },
    }));

    fetch(`/api/exchanges/${id}/sync`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json<{ error?: string }>();
          throw new Error(body.error ?? 'Sync fehlgeschlagen');
        }
        return res.json<SyncResult>();
      })
      .then((result) => {
        setSyncStates((prev) => ({
          ...prev,
          [id]: { syncing: false, result, error: null },
        }));
        // Update lastSyncAt on the connection
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, lastSyncAt: result.syncedAt } : c))
        );
        toast.success(
          `Synchronisiert: ${result.totalImported} importiert, ${result.totalDuplicates} Duplikate`
        );
      })
      .catch((err: Error) => {
        setSyncStates((prev) => ({
          ...prev,
          [id]: { syncing: false, result: null, error: err.message },
        }));
        toast.error(`Synchronisierung fehlgeschlagen: ${err.message}`);
      });
  };

  const handleSyncAll = () => {
    if (syncingAll) return;
    setSyncingAll(true);

    // Mark all as syncing
    setSyncStates((prev) => {
      const next = { ...prev };
      for (const conn of connections) {
        next[conn.id] = { syncing: true, result: null, error: null };
      }
      return next;
    });

    fetch('/api/exchanges/sync-all', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json<{ error?: string }>();
          throw new Error(body.error ?? 'Sync-All fehlgeschlagen');
        }
        return res.json<{
          results: SyncResult[];
          totalImported: number;
          totalDuplicates: number;
        }>();
      })
      .then(({ results, totalImported, totalDuplicates }) => {
        // Update each connection's sync state individually
        setSyncStates((prev) => {
          const next = { ...prev };
          for (const result of results) {
            const hasError = result.warnings.length > 0;
            next[result.connectionId] = {
              syncing: false,
              result: hasError ? null : result,
              error: hasError ? result.warnings[0] : null,
            };
          }
          return next;
        });
        // Update lastSyncAt for all successfully synced connections
        setConnections((prev) =>
          prev.map((c) => {
            const result = results.find((r) => r.connectionId === c.id);
            if (result && result.warnings.length === 0) {
              return { ...c, lastSyncAt: result.syncedAt };
            }
            return c;
          })
        );
        toast.success(
          `Alle synchronisiert: ${totalImported} importiert, ${totalDuplicates} Duplikate`
        );
      })
      .catch((err: Error) => {
        // Clear syncing state for all on error
        setSyncStates((prev) => {
          const next = { ...prev };
          for (const conn of connections) {
            next[conn.id] = { syncing: false, result: null, error: err.message };
          }
          return next;
        });
        toast.error(`Alle synchronisieren fehlgeschlagen: ${err.message}`);
      })
      .finally(() => {
        setSyncingAll(false);
      });
  };

  const isAnySyncing = Object.values(syncStates).some((s) => s.syncing);

  return (
    <div className="settings-tab">
      {/* Section 1: Exchange connections */}
      <section className="settings-tab__section" aria-label="Börsenverbindungen">
        <div className="settings-tab__section-header">
          <h2 className="settings-tab__section-title">Börsenverbindungen</h2>
          <div className="settings-tab__section-actions">
            {connections.length > 0 && (
              <button
                type="button"
                className="settings-tab__btn settings-tab__btn--sync-all"
                onClick={handleSyncAll}
                disabled={isAnySyncing || syncingAll}
              >
                {syncingAll ? 'Synchronisiere...' : 'Alle synchronisieren'}
              </button>
            )}
            <button
              type="button"
              className="settings-tab__btn settings-tab__btn--add"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? 'Abbrechen' : '+ Verbindung hinzufügen'}
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
              <CredentialForm onSave={handleSave} onCancel={() => setShowForm(false)} />
            </div>
          </GlassSurface>
        )}

        {loading ? (
          <p className="settings-tab__loading">Lade Verbindungen...</p>
        ) : connections.length === 0 && !showForm ? (
          <div className="settings-tab__empty">
            <p className="settings-tab__empty-text">
              Keine Exchange-Verbindungen konfiguriert. Füge eine Verbindung hinzu, um Trades
              automatisch zu importieren.
            </p>
          </div>
        ) : (
          <div className="settings-tab__connection-list">
            {connections.map((conn) => {
              const syncState = syncStates[conn.id];
              return (
                <ExchangeCard
                  key={conn.id}
                  connection={conn}
                  onDelete={handleDelete}
                  onSync={handleSync}
                  syncing={syncState?.syncing ?? false}
                  syncResult={syncState?.result ?? null}
                  syncError={syncState?.error ?? null}
                />
              );
            })}
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
            <h3 className="settings-tab__subsection-title">Passwort ändern</h3>
            <PasswordChange onLogout={onLogout} />
          </div>
        </GlassSurface>
      </section>
    </div>
  );
};

export default SettingsTab;
