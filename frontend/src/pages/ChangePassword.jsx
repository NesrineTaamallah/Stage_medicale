import EegTrace from '../components/EegTrace';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ChangePassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { tempToken } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      await client.post('/change-password', { newPassword }, {
        headers: { Authorization: `Bearer ${tempToken}` }
      });
      navigate('/', { state: { message: 'Mot de passe mis à jour. Reconnectez-vous.' } });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    }
  }

  return (
    <div className="auth-card">
      <EegTrace />
      <h1>Nouveau mot de passe</h1>
      <p className="subtitle">Première connexion — définissez un mot de passe personnel</p>
      <form onSubmit={handleSubmit}>
        <label>Nouveau mot de passe (10 car. min., majuscule, minuscule, chiffre, symbole)</label>
        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={10} />
        <label>Confirmer le mot de passe</label>
        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button type="submit">Valider</button>
      </form>
    </div>
  );
}