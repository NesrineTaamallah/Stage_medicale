import BrandMark from '../components/BrandMark';
import { IconEye, IconEyeOff, IconLock } from '../components/Icons';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotHint, setShowForgotHint] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setTempToken, setTotpToken, setPendingRole, completeAuth, setNeedsTotpSetup } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/login', { email, password });

      if (data.mustChangePassword) {
        setTempToken(data.tempToken);
        navigate('/change-password');
        return;
      }

      if (data.requiresTotp) {
        setTotpToken(data.totpToken);
        setPendingRole(data.role);
        navigate('/verify-totp');
        return;
      }

      completeAuth(data.user);
      setNeedsTotpSetup(true);
      navigate('/setup-totp');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 20px', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <BrandMark size={52} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: 'var(--ink)' }}>
          Registre Clinique
        </h1>
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: 0 }}>Connexion sécurisée à votre compte</p>
      </div>

      <div className="auth-card" style={{ margin: 0, textAlign: 'left' }}>
        <form onSubmit={handleSubmit}>
          <label>Adresse email</label>
          <input
            type="email"
            placeholder="votre@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            disabled={loading}
          />

          <label>Mot de passe</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              style={{
                position: 'absolute',
                right: 3,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 'auto',
                margin: 0,
                padding: '6px 8px',
                background: 'transparent',
                color: 'var(--slate)',
                boxShadow: 'none',
              }}
            >
              {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', fontWeight: 500, fontSize: 13, color: 'var(--slate)' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', margin: 0 }}
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Se souvenir de moi
            </label>
            <button
              type="button"
              onClick={() => setShowForgotHint((s) => !s)}
              style={{
                width: 'auto', margin: 0, padding: 0, background: 'transparent',
                color: 'var(--primary)', boxShadow: 'none', fontSize: 13, fontWeight: 600,
              }}
            >
              Mot de passe oublié ?
            </button>
          </div>
          {showForgotHint && (
            <p className="hint" style={{ marginTop: 8 }}>
              Contactez un administrateur : il pourra renvoyer un mot de passe temporaire à votre adresse.
            </p>
          )}

          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Connexion en cours…' : 'Se connecter'}
          </button>
        </form>

        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            marginTop: 20, padding: '12px 14px', background: 'var(--paper)', borderRadius: 10,
          }}
        >
          <IconLock size={14} color="var(--slate)" />
          <p style={{ margin: 0, fontSize: 12, color: 'var(--slate)', lineHeight: 1.5 }}>
            Votre connexion est sécurisée avec chiffrement SSL. Vos identifiants ne sont jamais partagés.
          </p>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--slate)', marginTop: 22 }}>
        <Link to="/" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
          ← Retour à l'accueil
        </Link>
      </p>
    </div>
  );
}
