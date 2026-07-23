import BrandMark from '../components/BrandMark';
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
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 20px', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <BrandMark size={52} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: '0 0 6px', color: 'var(--ink)' }}>
          Vérification en deux étapes
        </h1>
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: 0, maxWidth: 320 }}>
          Entrez le code affiché dans votre application d'authentification.
        </p>
      </div>

      <div className="auth-card" style={{ margin: 0, textAlign: 'left' }}>
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
    </div>
  );
}
