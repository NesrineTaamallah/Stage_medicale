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

export default function UsersTab({ onNavigateToUserLogs }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // Filtres
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  // Tri (correction #2)
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  // Formulaire de création (logique identique à l'existant)
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('clinicien');
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // correction #1
  const [createMsg, setCreateMsg] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  function fmtLastLogin(dateStr) {
    if (!dateStr) return 'Jamais connecté';
    return new Date(dateStr).toLocaleString('fr-FR');
  }

  function toggleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  function sortIndicator(field) {
    if (sortBy !== field) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

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

  const filtered = users
    .filter((u) => {
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchSearch = u.email.toLowerCase().includes(search.toLowerCase());
      return matchRole && matchSearch;
    })
    .sort((a, b) => {
      let va, vb;
      if (sortBy === 'last_login_at') {
        // "Jamais connecté" trié après les dates réelles, quel que soit le sens
        va = a.last_login_at ? new Date(a.last_login_at).getTime() : -Infinity;
        vb = b.last_login_at ? new Date(b.last_login_at).getTime() : -Infinity;
      } else {
        va = new Date(a.created_at).getTime();
        vb = new Date(b.created_at).getTime();
      }
      return sortDir === 'asc' ? va - vb : vb - va;
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
          {email && (
            <button
              type="button"
              className="secondary"
              style={{ marginTop: 12 }}
              onClick={() => setShowPreview((s) => !s)}
            >
              {showPreview ? "Masquer l'aperçu de l'email" : "Aperçu de l'email"}
            </button>
          )}

          {showPreview && email && (
            <div
              style={{
                marginTop: 12,
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '14px 16px',
                background: 'var(--card)',
                fontSize: 13.5,
              }}
            >
              <p className="hint" style={{ marginTop: 0 }}>
                À : <strong>{email}</strong> — Sujet : Votre accès au registre clinique — mot de passe temporaire
              </p>
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <p>Bonjour,</p>
                <p>
                  Un compte vous a été créé sur le registre clinique NeuroExo-Predict avec le rôle :{' '}
                  <strong>{role}</strong>.
                </p>
                <p>
                  Votre mot de passe temporaire est : <strong>••••••••</strong>{' '}
                  <span className="hint">(généré à la création, non visible avant validation)</span>
                </p>
                <p>Ce mot de passe est <strong>valable 48h</strong> et devra être changé dès votre première connexion.</p>
                <p><a href="#" onClick={(e) => e.preventDefault()}>Se connecter</a></p>
                <p className="hint">Si vous n'êtes pas à l'origine de cette demande, contactez l'administrateur du système.</p>
              </div>
            </div>
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
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('created_at')}>
                  Créé le{sortIndicator('created_at')}
                </th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('last_login_at')}>
                  Dernière connexion{sortIndicator('last_login_at')}
                </th>
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
                  <td className={!u.last_login_at ? 'hint' : undefined}>{fmtLastLogin(u.last_login_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="secondary"
                        onClick={() => onNavigateToUserLogs?.(u.id)}
                      >
                        Historique
                      </button>
                      {u.tempPasswordStatus && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(
                            u.id,
                            'resend-temp-password',
                            `Renvoyer un nouveau mot de passe temporaire à ${u.email} ?\n\nAvant : ${u.tempPasswordStatus === 'expired' ? 'Mot de passe probablement expiré' : 'En attente de 1ère connexion'}\nAprès : Nouveau mot de passe généré, délai de 48h relancé, ancien mot de passe invalidé`
                          )}
                        >
                          Renvoyer mdp
                        </button>
                      )}
                      {u.locked_until && new Date(u.locked_until) > new Date() && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(
                            u.id,
                            'unlock',
                            `Déverrouiller ${u.email} ?\n\nAvant : Verrouillé jusqu'au ${new Date(u.locked_until).toLocaleString('fr-FR')}\nAprès : Compte actif, compteur d'échecs remis à zéro`
                          )}
                        >
                          Déverrouiller
                        </button>
                      )}
                      {u.is_2fa_enabled && (
                        <button
                          className="secondary"
                          disabled={busyId === u.id}
                          onClick={() => runAction(
                            u.id,
                            'reset-2fa',
                            `Réinitialiser le 2FA de ${u.email} ?\n\nAvant : 2FA actif\nAprès : 2FA désactivé — l'utilisateur devra re-scanner un nouveau QR code à sa prochaine connexion`
                          )}
                        >
                          Reset 2FA
                        </button>
                      )}
                      <button
                        className="secondary"
                        disabled={busyId === u.id}
                        onClick={() => runAction(
                          u.id,
                          'toggle-active',
                          `${u.is_active ? 'Désactiver' : 'Réactiver'} le compte de ${u.email} ?\n\nAvant : ${u.is_active ? 'Actif' : 'Désactivé'}\nAprès : ${u.is_active ? 'Désactivé — l\'utilisateur ne pourra plus se connecter' : 'Actif — l\'utilisateur pourra de nouveau se connecter'}`
                        )}
                      >
                        {u.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center' }}>Aucun utilisateur trouvé.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}