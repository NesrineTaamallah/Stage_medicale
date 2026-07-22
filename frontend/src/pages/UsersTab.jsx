import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

function StatusBadges({ u }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {u.must_change_password && (
        <span className={`badge ${u.tempPasswordStatus === 'expired' ? 'badge-error' : 'badge-warning'}`}>
          {u.tempPasswordStatus === 'expired' ? 'Mot de passe expiré' : 'En attente 1ère connexion'}
        </span>
      )}
      {u.is_2fa_enabled && <span className="badge badge-success">2FA actif</span>}
      {u.locked_until && new Date(u.locked_until) > new Date() && (
        <span className="badge badge-error">Verrouillé</span>
      )}
      {!u.is_active && <span className="badge badge-muted">Désactivé</span>}
    </div>
  );
}

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // Filtres
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  // Formulaire de création (logique identique à l'existant)
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('clinicien');
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/admin/users/detailed');
      setUsers(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de chargement des utilisateurs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateErr(''); setCreateMsg('');

    if (role === 'admin' && !confirmAdmin) {
      setCreateErr('Cochez la confirmation pour créer un compte admin.');
      return;
    }

    try {
      const { data } = await client.post('/admin/users', { email, role });
      setCreateMsg(`Compte créé pour ${data.user.email} (${data.user.role}).`);
      setEmail(''); setConfirmAdmin(false);
      fetchUsers();
    } catch (err) {
      setCreateErr(err.response?.data?.error || 'Erreur.');
    }
  }

  async function runAction(id, path, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(id);
    setActionMessage('');
    try {
      const { data } = await client.post(`/admin/users/${id}/${path}`);
      setActionMessage(data.message);
      fetchUsers();
    } catch (err) {
      setActionMessage(err.response?.data?.error || 'Erreur lors de l\'action.');
    } finally {
      setBusyId(null);
    }
  }

  const filtered = users.filter((u) => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchSearch = u.email.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Créer un utilisateur</h2>
        <form onSubmit={handleCreate}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>Rôle</label>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="clinicien">Clinicien</option>
            <option value="chercheur">Chercheur</option>
            <option value="admin">Admin</option>
          </select>
          {role === 'admin' && (
            <label style={{ textTransform: 'none', display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={confirmAdmin}
                onChange={e => setConfirmAdmin(e.target.checked)}
              />
              Je confirme vouloir créer un compte admin (action sensible)
            </label>
          )}
          {createMsg && <p className="success">{createMsg}</p>}
          {createErr && <p className="error">{createErr}</p>}
          <button type="submit">Créer l'utilisateur</button>
        </form>
      </div>

      <div className="card">
        <h2>Liste des utilisateurs</h2>

        <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
          <input
            style={{ flex: 1 }}
            placeholder="Rechercher par email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={{ maxWidth: 200 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="all">Tous les rôles</option>
            <option value="admin">Admin</option>
            <option value="clinicien">Clinicien</option>
            <option value="chercheur">Chercheur</option>
          </select>
        </div>

        {actionMessage && <p className="hint">{actionMessage}</p>}
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="subtitle">Chargement...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '8px 6px' }}>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Créé le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 6px' }}>{u.email}</td>
                  <td>{u.role}</td>
                  <td><StatusBadges u={u} /></td>
                  <td>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {u.tempPasswordStatus && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(u.id, 'resend-temp-password', `Renvoyer un nouveau mot de passe temporaire à ${u.email} ?`)}
                        >
                          Renvoyer mdp
                        </button>
                      )}
                      {u.locked_until && new Date(u.locked_until) > new Date() && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(u.id, 'unlock')}
                        >
                          Déverrouiller
                        </button>
                      )}
                      {u.is_2fa_enabled && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(u.id, 'reset-2fa', `Réinitialiser le 2FA de ${u.email} ?`)}
                        >
                          Reset 2FA
                        </button>
                      )}
                      <button
                        className="secondary"
                        disabled={busyId === u.id}
                        onClick={() => runAction(u.id, 'toggle-active', `${u.is_active ? 'Désactiver' : 'Réactiver'} le compte de ${u.email} ?`)}
                      >
                        {u.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center' }}>Aucun utilisateur trouvé.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}