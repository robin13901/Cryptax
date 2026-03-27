import { useState } from 'react';
import './PasswordChange.css';

interface PasswordChangeProps {
  onLogout: () => void;
}

const PasswordChange = ({ onLogout }: PasswordChangeProps) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validate = (): string | null => {
    if (!currentPassword) return 'Bitte aktuelles Passwort eingeben';
    if (newPassword.length < 8) return 'Neues Passwort muss mindestens 8 Zeichen lang sein';
    if (newPassword !== confirmPassword) return 'Passwörter stimmen nicht überein';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (res.ok) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await res.json<{ error?: string }>();
        setError(data.error ?? 'Passwort konnte nicht geändert werden');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="password-change">
      <form className="password-change__form" onSubmit={handleSubmit} noValidate>
        <div className="password-change__field">
          <label className="password-change__label" htmlFor="pw-current">
            Aktuelles Passwort
          </label>
          <input
            id="pw-current"
            type="password"
            className="password-change__input"
            placeholder="Aktuelles Passwort"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="password-change__field">
          <label className="password-change__label" htmlFor="pw-new">
            Neues Passwort
          </label>
          <input
            id="pw-new"
            type="password"
            className="password-change__input"
            placeholder="Neues Passwort (min. 8 Zeichen)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="password-change__field">
          <label className="password-change__label" htmlFor="pw-confirm">
            Neues Passwort bestätigen
          </label>
          <input
            id="pw-confirm"
            type="password"
            className="password-change__input"
            placeholder="Neues Passwort wiederholen"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p className="password-change__error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="password-change__success" role="status">
            Passwort erfolgreich geändert
          </p>
        )}

        <button
          type="submit"
          className="password-change__btn"
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
        >
          {saving ? 'Speichern...' : 'Passwort ändern'}
        </button>
      </form>

      <div className="password-change__logout-section">
        <button type="button" className="password-change__logout-btn" onClick={onLogout}>
          Abmelden
        </button>
      </div>
    </div>
  );
};

export default PasswordChange;
