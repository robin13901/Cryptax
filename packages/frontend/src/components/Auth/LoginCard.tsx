import { motion } from 'motion/react';
import { useState } from 'react';
import GlassSurface from '../GlassSurface/GlassSurface';
import './LoginCard.css';

interface LoginCardProps {
  onSuccess: () => void;
}

const LoginCard = ({ onSuccess }: LoginCardProps) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        onSuccess();
      } else if (res.status === 401) {
        setError('Falsches Passwort');
      } else {
        setError('Anmeldung fehlgeschlagen');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-card-wrapper">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <GlassSurface width="100%" height="auto" borderRadius={16}>
          <div className="login-card__inner">
            <div className="login-card__header">
              <h1 className="login-card__title">Cryptax</h1>
              <p className="login-card__subtitle">Anmeldung</p>
            </div>

            <form className="login-card__form" onSubmit={handleSubmit}>
              <div className="login-card__field">
                <input
                  type="password"
                  className="login-card__input"
                  placeholder="Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p className="login-card__error" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="login-card__btn"
                disabled={loading || password.length === 0}
              >
                {loading ? 'Anmelden...' : 'Anmelden'}
              </button>
            </form>
          </div>
        </GlassSurface>
      </motion.div>
    </div>
  );
};

export default LoginCard;
