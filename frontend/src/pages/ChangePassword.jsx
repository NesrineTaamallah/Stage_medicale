import EegTrace from '../components/EegTrace';
import { IconCheckCircle } from '../components/Icons';
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

export default function ChangePassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    <div className="auth-card">
      <EegTrace />
      <p className="eyebrow">Première connexion</p>
      <h1>Nouveau mot de passe</h1>
      <p className="subtitle">Définissez un mot de passe personnel pour remplacer le mot de passe temporaire.</p>
      <form onSubmit={handleSubmit}>
        <label>Nouveau mot de passe</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={10}
          disabled={loading}
        />

        {newPassword.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {RULES.map((r) => {
              const ok = r.test(newPassword);
              return (
                <span
                  key={r.label}
                  className={`badge ${ok ? 'badge-success' : 'badge-muted'}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
                >
                  {ok && <IconCheckCircle size={10} color="var(--success)" />}
                  {r.label}
                </span>
              );
            })}
          </div>
        )}

        <label>Confirmer le mot de passe</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={loading}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Validation…' : 'Valider'}
        </button>
      </form>
    </div>
  );
}