import type { ExchangeConnection, ExchangeCredentials } from '@cryptax/shared';
import { useState } from 'react';
import './CredentialForm.css';

interface CredentialFormProps {
  onSave: (connection: ExchangeConnection) => void;
  onCancel: () => void;
}

interface RevealState {
  apiKey: boolean;
  secret: boolean;
  passphrase: boolean;
}

const CredentialForm = ({ onSave, onCancel }: CredentialFormProps) => {
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [reveal, setReveal] = useState<RevealState>({
    apiKey: false,
    secret: false,
    passphrase: false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleReveal = (field: keyof RevealState) => {
    setReveal((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const isValid =
    label.trim() !== '' && apiKey.trim() !== '' && secret.trim() !== '' && passphrase.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setError(null);
    setTestResult(null);
    setSaving(true);

    try {
      const credentials: ExchangeCredentials = {
        apiKey: apiKey.trim(),
        secret: secret.trim(),
        password: passphrase.trim(),
      };

      const res = await fetch('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: 'bitget',
          label: label.trim(),
          credentials,
        }),
      });

      if (!res.ok) {
        const data = await res.json<{ error?: string }>();
        setError(data.error ?? 'Fehler beim Speichern');
        return;
      }

      const connection = await res.json<ExchangeConnection>();
      setSaving(false);
      setTesting(true);

      // Auto-test after save
      try {
        const testRes = await fetch(`/api/exchanges/${connection.id}/test`, { method: 'POST' });
        const result = await testRes.json<{ success: boolean; error?: string }>();
        setTestResult(result);
      } catch {
        setTestResult({ success: false, error: 'Verbindungstest fehlgeschlagen' });
      } finally {
        setTesting(false);
      }

      onSave(connection);
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="credential-form" onSubmit={handleSubmit} noValidate>
      <div className="credential-form__field">
        <label className="credential-form__label" htmlFor="cred-label">
          Bezeichnung
        </label>
        <input
          id="cred-label"
          type="text"
          className="credential-form__input"
          placeholder="z.B. Mein Bitget-Konto"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="credential-form__field">
        <label className="credential-form__label" htmlFor="cred-api-key">
          API Key
        </label>
        <div className="credential-form__secret-wrap">
          <input
            id="cred-api-key"
            type={reveal.apiKey ? 'text' : 'password'}
            className="credential-form__input credential-form__input--secret"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="credential-form__eye"
            aria-label={reveal.apiKey ? 'API Key verbergen' : 'API Key anzeigen'}
            onClick={() => toggleReveal('apiKey')}
          >
            {reveal.apiKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <div className="credential-form__field">
        <label className="credential-form__label" htmlFor="cred-secret">
          Secret
        </label>
        <div className="credential-form__secret-wrap">
          <input
            id="cred-secret"
            type={reveal.secret ? 'text' : 'password'}
            className="credential-form__input credential-form__input--secret"
            placeholder="Secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="credential-form__eye"
            aria-label={reveal.secret ? 'Secret verbergen' : 'Secret anzeigen'}
            onClick={() => toggleReveal('secret')}
          >
            {reveal.secret ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <div className="credential-form__field">
        <label className="credential-form__label" htmlFor="cred-passphrase">
          Passphrase
        </label>
        <div className="credential-form__secret-wrap">
          <input
            id="cred-passphrase"
            type={reveal.passphrase ? 'text' : 'password'}
            className="credential-form__input credential-form__input--secret"
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="credential-form__eye"
            aria-label={reveal.passphrase ? 'Passphrase verbergen' : 'Passphrase anzeigen'}
            onClick={() => toggleReveal('passphrase')}
          >
            {reveal.passphrase ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      {error && (
        <p className="credential-form__error" role="alert">
          {error}
        </p>
      )}

      {testing && (
        <p className="credential-form__status credential-form__status--testing">
          Verbindung wird geprüft...
        </p>
      )}

      {testResult && !testing && (
        <p
          className={`credential-form__status ${
            testResult.success
              ? 'credential-form__status--success'
              : 'credential-form__status--warning'
          }`}
          role="status"
        >
          {testResult.success
            ? 'Verbindung erfolgreich'
            : `Verbindungstest: ${testResult.error ?? 'Unbekannter Fehler'}`}
        </p>
      )}

      <div className="credential-form__actions">
        <button
          type="button"
          className="credential-form__btn credential-form__btn--cancel"
          onClick={onCancel}
          disabled={saving || testing}
        >
          Abbrechen
        </button>
        <button
          type="submit"
          className="credential-form__btn credential-form__btn--save"
          disabled={!isValid || saving || testing}
        >
          {saving ? 'Speichern...' : 'Verbindung speichern'}
        </button>
      </div>
    </form>
  );
};

export default CredentialForm;
