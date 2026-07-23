import EegTrace from '../components/EegTrace';
import { IconLock } from '../components/Icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function VerifyTotp() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { totpToken, completeAuth } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/2fa/validate', { totpToken, code });
      completeAuth(data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <EegTrace />
      <div className="icon" style={{ width: 34, height: 34, borderRadius: 4, background: 'var(--teal-tint)', color: 'var(--teal-deep)', marginBottom: 12 }}>
        <IconLock size={17} />
      </div>
      <h1>Vérification en deux étapes</h1>
      <p className="subtitle">Entrez le code affiché dans votre application d'authentification.</p>
      <form onSubmit={handleSubmit}>
        <label>Code à 6 chiffres</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          maxLength={6}
          inputMode="numeric"
          autoFocus
          disabled={loading}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading || code.length !== 6}>
          {loading ? 'Vérification…' : 'Valider'}
        </button>
      </form>
      <hr className="hairline" style={{ margin: '22px 0 14px' }} />
      <p className="hint" style={{ textAlign: 'center' }}>
        Code expiré ou perdu ? Contactez un administrateur pour une réinitialisation du 2FA.
      </p>
    </div>
  );
}