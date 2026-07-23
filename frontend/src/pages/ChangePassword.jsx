import BrandMark from '../components/BrandMark';
import { IconCheckCircle, IconEye, IconEyeOff, IconLock } from '../components/Icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

const RULES = [
  { test: (p) => p.length >= 10, label: '10 caractères min.' },
  { test: (p) => /[A-Z]/.test(p), label: 'Une majuscule' },
  { test: (p) => /[a-z]/.test(p), label: 'Une minuscule' },
  { test: (p) => /[0-9]/.test(p), label: 'Un chiffre' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'Un symbole' },
];

function PasswordField({ label, value, onChange, show, onToggleShow, minLength, disabled, autoComplete }) {
  return (
    <>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required
          minLength={minLength}
          disabled={disabled}
          autoComplete={autoComplete}
          style={{ paddingRight: 42 }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          title={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          style={{
            position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)',
            width: 'auto', margin: 0, padding: '6px 8px', background: 'transparent',
            color: 'var(--slate)', boxShadow: 'none',
          }}
        >
          {show ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      </div>
    </>
  );
}

export default function ChangePassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { tempToken } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    try {
      await client.post(
        '/change-password',
        { newPassword },
        { headers: { Authorization: `Bearer ${tempToken}` } }
      );
      navigate('/login', { state: { message: 'Mot de passe mis à jour. Reconnectez-vous.' } });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
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
          Changement de mot de passe
        </h1>
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: 0, maxWidth: 340 }}>
          Créez un nouveau mot de passe sécurisé pour votre compte.
        </p>
      </div>

      <div className="auth-card" style={{ margin: 0, textAlign: 'left' }}>
        <form onSubmit={handleSubmit}>
          <PasswordField
            label="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            show={showPassword}
            onToggleShow={() => setShowPassword((s) => !s)}
            minLength={10}
            disabled={loading}
            autoComplete="new-password"
          />

          {newPassword.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {RULES.map((r) => {
                const ok = r.test(newPassword);
                return (
                  <span
                    key={r.label}
                    className={`badge ${ok ? 'badge-success' : 'badge-muted'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500, textTransform: 'none' }}
                  >
                    {ok && <IconCheckCircle size={10} color="var(--success)" />}
                    {r.label}
                  </span>
                );
              })}
            </div>
          )}

          <PasswordField
            label="Confirmer le mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            show={showPassword}
            onToggleShow={() => setShowPassword((s) => !s)}
            disabled={loading}
            autoComplete="new-password"
          />

          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Validation…' : 'Mettre à jour le mot de passe'}
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
            Votre mot de passe est chiffré et sécurisé. Utilisez un mot de passe unique que vous ne réutilisez nulle part ailleurs.
          </p>
        </div>
      </div>
    </div>
  );
}
