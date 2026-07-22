import EegTrace from '../components/EegTrace';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function VerifyTotp() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { totpToken, completeAuth } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await client.post('/2fa/validate', { totpToken, code });
      completeAuth(data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide.');
    }
  }

  return (
    <div className="auth-card">
      <EegTrace />
      <h1>Vérification en 2 étapes</h1>
      <p className="subtitle">Entrez le code affiché dans votre application d'authentification</p>
      <form onSubmit={handleSubmit}>
        <label>Code à 6 chiffres</label>
        <input value={code} onChange={e => setCode(e.target.value)} required maxLength={6} autoFocus />
        {error && <p className="error">{error}</p>}
        <button type="submit">Valider</button>
      </form>
    </div>
  );
}