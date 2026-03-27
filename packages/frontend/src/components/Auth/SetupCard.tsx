import { motion } from 'motion/react';
import { useState } from 'react';
import GlassSurface from '../GlassSurface/GlassSurface';
import './SetupCard.css';

interface SetupCardProps {
  onSuccess: () => void;
}

const SetupCard = ({ onSuccess }: SetupCardProps) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = (): string | null => {
    if (password.length < 8) {
      return 'Passwort muss mindestens 8 Zeichen lang sein';
    }
    if (password !== confirm) {
      return 'Passwörter stimmen nicht überein';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.status === 201) {
        onSuccess();
      } else {
        const data = await res.json<{ error?: string }>();
        setError(data.error ?? 'Fehler beim Setzen des Passworts');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-card-wrapper">
      <motion.div
        className="setup-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <GlassSurface width="100%" height="auto" borderRadius={16}>
          <div className="setup-card__inner">
            <div className="setup-card__header">
              <h1 className="setup-card__title">Cryptax</h1>
              <p className="setup-card__subtitle">Passwort erstellen</p>
            </div>

            <p className="setup-card__hint">
              Erster Start – bitte lege ein Passwort fest, um die App zu schützen.
            </p>

            <form className="setup-card__form" onSubmit={handleSubmit}>
              <div className="setup-card__field">
                <input
                  type="password"
                  className="setup-card__input"
                  placeholder="Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div className="setup-card__field">
                <input
                  type="password"
                  className="setup-card__input"
                  placeholder="Passwort bestätigen"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="setup-card__error" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="setup-card__btn"
                disabled={loading || password.length === 0}
              >
                {loading ? 'Speichern...' : 'Passwort setzen'}
              </button>
            </form>
          </div>
        </GlassSurface>
      </motion.div>
    </div>
  );
};

export default SetupCard;
