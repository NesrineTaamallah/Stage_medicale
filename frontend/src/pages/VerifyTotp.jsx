import BrandMark from '../components/BrandMark';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function VerifyTotp() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const { totpToken, pendingRole, setTotpToken, setPendingRole, completeAuth } = useAuth();
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

  // Recours d'urgence, réservé aux admins : réinitialise la 2FA du compte
  // directement depuis cette page (le totpToken prouve déjà que le mot de
  // passe était correct). Volontairement pas d'auto-connexion ensuite :
  // l'admin doit se reconnecter normalement, ce qui l'enverra vers la
  // configuration d'un nouveau QR code.
  async function handleSelfReset() {
    setError('');
    const confirmed = window.confirm(
      "Réinitialiser votre propre 2FA ?\n\n" +
      "À utiliser uniquement si vous avez perdu l'accès à votre application d'authentification.\n" +
      "Cette action est journalisée. Vous devrez vous reconnecter et configurer un nouveau QR code."
    );
    if (!confirmed) return;

    setResetLoading(true);
    try {
      await client.post('/2fa/self-reset-admin', { totpToken });
      setResetDone(true);
      setTotpToken(null);
      setPendingRole(null);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation.');
    } finally {
      setResetLoading(false);
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
        {resetDone ? (
          <p className="hint" style={{ textAlign: 'center' }}>
            2FA réinitialisée. Redirection vers la connexion...
          </p>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              <label>Code à 6 chiffres</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                maxLength={6}
                inputMode="numeric"
                autoFocus
                disabled={loading || resetLoading}
              />
              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={loading || resetLoading || code.length !== 6}>
                {loading ? 'Vérification…' : 'Valider'}
              </button>
            </form>
            <hr className="hairline" style={{ margin: '22px 0 14px' }} />
            {pendingRole === 'admin' ? (
              <>
                <p className="hint" style={{ textAlign: 'center' }}>
                  Vous avez perdu l'accès à votre application d'authentification ?
                </p>
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: 10, width: '100%' }}
                  disabled={resetLoading}
                  onClick={handleSelfReset}
                >
                  {resetLoading ? 'Réinitialisation…' : 'Réinitialiser ma 2FA'}
                </button>
                <p className="hint" style={{ textAlign: 'center', marginTop: 8, fontSize: 11.5 }}>
                  Réservé aux comptes admin. Action journalisée, à n'utiliser qu'en cas de perte réelle.
                </p>
              </>
            ) : (
              <p className="hint" style={{ textAlign: 'center' }}>
                Code expiré ou perdu ? Contactez un administrateur pour une réinitialisation du 2FA.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
