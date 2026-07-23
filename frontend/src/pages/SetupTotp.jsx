import BrandMark from '../components/BrandMark';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

function StepDots({ active }) {
  const steps = [1, 2, 3];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '18px 0 22px' }}>
      {steps.map((n, i) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              background: n <= active ? 'var(--primary)' : 'var(--line)',
              color: n <= active ? '#fff' : 'var(--slate)',
              transition: 'background 0.2s ease',
            }}
          >
            {n}
          </span>
          {i < steps.length - 1 && (
            <span style={{ width: 34, height: 2, background: n < active ? 'var(--primary)' : 'var(--line)', margin: '0 4px' }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SetupTotp() {
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  async function generateQr() {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/2fa/setup', {});
      setQrCode(data.qrCodeDataUrl);
      setManualKey(data.manualEntryKey);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setLoading(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/2fa/confirm', { code });
      navigate(user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide.');
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    if (!manualKey) return;
    navigator.clipboard?.writeText(manualKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const step = !qrCode ? 1 : 2;

  return (
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 20px', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <BrandMark size={52} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: '0 0 6px', color: 'var(--ink)' }}>
          Authentification 2FA
        </h1>
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: 0 }}>
          Sécurisez votre compte avec une authentification à deux facteurs
        </p>
      </div>

      <div className="auth-card" style={{ margin: '0', textAlign: 'left', maxWidth: 440 }}>
        <StepDots active={step} />

        {!qrCode ? (
          <>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', margin: '0 0 12px' }}>
              1. Générez votre code QR pour commencer
            </p>
            {error && <p className="error">{error}</p>}
            <button onClick={generateQr} disabled={loading}>
              {loading ? 'Génération…' : 'Générer le QR code'}
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', margin: '0 0 10px' }}>
              1. Scannez ce code QR avec une application d'authentification :
            </p>
            <div
              style={{
                border: '1px solid var(--line)', borderRadius: 14, padding: 18,
                display: 'flex', justifyContent: 'center', background: '#fff',
              }}
            >
              <img src={qrCode} alt="QR code TOTP" style={{ width: 190, height: 190, display: 'block' }} />
            </div>

            <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', margin: '18px 0 8px' }}>
              2. Vous pouvez aussi entrer cette clé manuellement :
            </p>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--paper)',
              }}
            >
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all' }}>{manualKey}</code>
              <button type="button" className="secondary" style={{ flexShrink: 0 }} onClick={copyKey}>
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>

            <div
              style={{
                display: 'flex', gap: 8, marginTop: 16, padding: '12px 14px',
                background: 'var(--primary-tint)', borderRadius: 10, fontSize: 12.5, color: 'var(--primary-deep)', lineHeight: 1.5,
              }}
            >
              💡 Recommandations : Google Authenticator, Microsoft Authenticator, Authy, ou FreeOTP
            </div>

            <form onSubmit={confirm}>
              <label>3. Entrez le code à 6 chiffres</label>
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
              <button type="submit" disabled={loading}>
                {loading ? 'Vérification…' : 'Vérifier le code'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
