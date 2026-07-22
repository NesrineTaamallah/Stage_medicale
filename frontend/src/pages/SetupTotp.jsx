import EegTrace from '../components/EegTrace';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SetupTotp() {
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  async function generateQr() {
    setError('');
    try {
      const { data } = await client.post('/2fa/setup', {});
      setQrCode(data.qrCodeDataUrl);
      setManualKey(data.manualEntryKey);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post('/2fa/confirm', { code }); // ✅ corrigé : "code" au lieu de "token"
      navigate(user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide.');
    }
  }

  return (
    <div className="auth-card">
      <EegTrace />
      <h1>Sécuriser votre compte</h1>
      <p className="subtitle">Scannez ce QR code avec Google Authenticator ou Authy</p>

      {!qrCode ? (
        <button onClick={generateQr}>Générer le QR code</button>
      ) : (
        <>
          <img src={qrCode} alt="QR code TOTP" className="qr-code" />
          <p className="hint">Clé manuelle si le scan échoue : <code>{manualKey}</code></p>
          <form onSubmit={confirm}>
            <label>Code à 6 chiffres</label>
            <input value={code} onChange={e => setCode(e.target.value)} required maxLength={6} />
            {error && <p className="error">{error}</p>}
            <button type="submit">Confirmer et activer</button>
          </form>
        </>
      )}
    </div>
  );
}