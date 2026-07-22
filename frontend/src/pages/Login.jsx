import EegTrace from '../components/EegTrace';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { setTempToken, setTotpToken, completeAuth, setNeedsTotpSetup } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
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

      // Connexion directe (2FA non encore configuré) — le cookie httpOnly est déjà posé par le backend
      completeAuth(data.user);
      setNeedsTotpSetup(true);
      navigate('/setup-totp');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion.');
    }
  }

  return (
    <div className="auth-card">
      <EegTrace />
      <h1>Registre clinique NeuroExo-Predict</h1>
      <p className="subtitle">Connexion sécurisée</p>
      <form onSubmit={handleSubmit}>
        <label>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Mot de passe</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}