import EegTrace from '../components/EegTrace';
import { IconLock, IconCheckCircle } from '../components/Icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

function Step({ n, label, state }) {
  // state: 'done' | 'active' | 'pending'
  const color =
    state === 'done' ? 'var(--success)' : state === 'active' ? 'var(--teal)' : 'var(--slate-soft)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1.4px solid ${color}`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          flexShrink: 0,
        }}
      >
        {state === 'done' ? <IconCheckCircle size={11} color={color} /> : n}
      </span>
      <span style={{ color: state === 'pending' ? 'var(--slate-soft)' : 'var(--ink)' }}>{label}</span>
    </div>
  );
}

export default function SetupTotp() {
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState(null);
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

  return (
    <div className="auth-card" style={{ maxWidth: 440 }}>
      <EegTrace />
      <div className="icon" style={{ width: 34, height: 34, borderRadius: 4, background: 'var(--teal-tint)', color: 'var(--teal-deep)', marginBottom: 12 }}>
        <IconLock size={17} />
      </div>
      <h1>Sécuriser votre compte</h1>
      <p className="subtitle">La double authentification est obligatoire sur ce registre.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', background: 'var(--paper)', borderRadius: 4, marginBottom: 4 }}>
        <Step n={1} label="Générer le QR code" state={!qrCode ? 'active' : 'done'} />
        <Step n={2} label="Scanner avec Google Authenticator ou Authy" state={qrCode ? 'active' : 'pending'} />
        <Step n={3} label="Confirmer avec le code à 6 chiffres" state="pending" />
      </div>

      {!qrCode ? (
        <button onClick={generateQr} disabled={loading}>
          {loading ? 'Génération…' : 'Générer le QR code'}
        </button>
      ) : (
        <>
          <img src={qrCode} alt="QR code TOTP" className="qr-code" />
          <p className="hint">
            Clé manuelle si le scan échoue : <code>{manualKey}</code>
          </p>
          <form onSubmit={confirm}>
            <label>Code à 6 chiffres</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={6}
              inputMode="numeric"
              autoFocus
              disabled={loading}
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Vérification…' : 'Confirmer et activer'}
            </button>
          </form>
        </>
      )}
      {error && !qrCode && <p className="error">{error}</p>}
    </div>
  );
}