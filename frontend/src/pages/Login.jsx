import EegTrace from '../components/EegTrace';
import { IconArrowLeft, IconEye, IconEyeOff } from '../components/Icons';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setTempToken, setTotpToken, completeAuth, setNeedsTotpSetup } = useAuth();

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
    <div className="auth-card">
      <EegTrace />
      <Link
        to="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          color: 'var(--slate)',
          textDecoration: 'none',
          marginBottom: 10,
        }}
      >
        <IconArrowLeft size={13} />
        Retour à l'accueil
      </Link>
      <p className="eyebrow">Accès professionnel</p>
      <h1>Registre clinique</h1>
      <p className="subtitle">Connectez-vous avec vos identifiants NeuroExo‑Predict.</p>
      <form onSubmit={handleSubmit}>
        <label>Adresse email</label>
        <input
          type="email"
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

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Connexion en cours…' : 'Se connecter'}
        </button>
      </form>
      <hr className="hairline" style={{ margin: '22px 0 14px' }} />
      <p className="hint" style={{ textAlign: 'center' }}>
        Accès réservé au personnel autorisé. Contactez un administrateur en cas de problème.
      </p>
    </div>
  );
}