import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';
import { IconPlus, IconX, IconDots, IconHistory, IconMail, IconUnlock, IconLock } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import Toast from '../components/Toast';

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

// Toggle inline pour l'état actif/inactif : action fréquente et réversible,
// elle reste visible directement dans la ligne plutôt que noyée dans un menu.
function StatusToggle({ user, busy, onToggle }) {
  return (
    <button
      type="button"
      className={`status-toggle${user.is_active ? ' is-active' : ''}`}
      disabled={busy}
      onClick={onToggle}
      aria-pressed={user.is_active}
      aria-label={user.is_active ? 'Désactiver le compte' : 'Réactiver le compte'}
    >
      <span className="track"><span className="thumb" /></span>
      <span className="toggle-label">{user.is_active ? 'actif' : 'inactif'}</span>
    </button>
  );
}

// Menu groupé pour les actions secondaires : les actions à risque (2FA, désactivation)
// sont visuellement séparées et colorées pour éviter tout mis-clic.
function ActionsMenu({ user, busy, open, isSelf, onToggleOpen, onHistory, onResendPassword, onUnlock, onReset2FA }) {
  const isLocked = user.locked_until && new Date(user.locked_until) > new Date();

  return (
    <div className="actions-cell" style={{ position: 'relative' }}>
      <button
        type="button"
        className="kebab-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Plus d'actions"
        onClick={onToggleOpen}
      >
        <IconDots size={17} />
      </button>
      {open && (
        <div className="actions-menu" role="menu">
          <div className="actions-menu-group">
            <button type="button" className="actions-menu-item" role="menuitem" onClick={onHistory}>
              <IconHistory size={15} /> Historique
            </button>
            <button type="button" className="actions-menu-item" role="menuitem" disabled={busy} onClick={onResendPassword}>
              <IconMail size={15} /> {user.tempPasswordStatus ? 'Renvoyer mdp' : 'Réinitialiser mdp'}
            </button>
            {isLocked && (
              <button type="button" className="actions-menu-item" role="menuitem" disabled={busy} onClick={onUnlock}>
                <IconUnlock size={15} /> Déverrouiller
              </button>
            )}
          </div>
          {user.is_2fa_enabled && (
            <div className="actions-menu-group">
              <button
                type="button"
                className="actions-menu-item risk-medium"
                role="menuitem"
                disabled={busy || isSelf}
                title={isSelf ? "Vous ne pouvez pas réinitialiser votre propre 2FA — demandez à un autre admin." : undefined}
                onClick={onReset2FA}
              >
                <IconLock size={15} /> Réinitialiser 2FA
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DORMANT_DAYS = 60;

// Filtres rapides déclenchés depuis la Vue d'ensemble ("revue groupée") :
// évite à l'admin de recréer manuellement le filtre qu'il vient de voir sur un compteur.
const QUICK_FILTERS = {
  dormant: {
    label: 'Comptes dormants (> 60j sans connexion)',
    test: (u) => {
      if (!u.is_active || !u.last_login_at) return false;
      const days = (Date.now() - new Date(u.last_login_at).getTime()) / (1000 * 60 * 60 * 24);
      return days > DORMANT_DAYS;
    },
  },
  tempPassword: {
    label: 'Mots de passe temporaires en attente ou expirés',
    test: (u) => !!u.tempPasswordStatus,
  },
};

export default function UsersTab({ onNavigateToUserLogs, initialQuickFilter, onQuickFilterHandled }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filtres
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState(initialQuickFilter || null);

  useEffect(() => {
    if (initialQuickFilter) {
      setQuickFilter(initialQuickFilter);
      onQuickFilterHandled?.();
    }
  }, [initialQuickFilter, onQuickFilterHandled]);

  // Tri (correction #2)
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  // Formulaire de création (logique identique à l'existant)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('clinicien');
  const [organizationName, setOrganizationName] = useState('');
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPreview, setShowPreview] = useState(false); // correction #1
  const [createMsg, setCreateMsg] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Menu d'actions groupé (⋮) : un seul ouvert à la fois, fermé au clic extérieur / Échap
  const [openMenuId, setOpenMenuId] = useState(null);
  const tableRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (tableRef.current && !tableRef.current.contains(e.target)) setOpenMenuId(null);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpenMenuId(null);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  function openCreateModal() {
    setEmail(''); setRole('clinicien'); setOrganizationName(''); setConfirmAdmin(false); setAdminPassword('');
    setShowPreview(false); setCreateMsg(''); setCreateErr('');
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
  }

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
    if (role === 'admin' && !adminPassword) {
      setCreateErr('Ressaisissez votre mot de passe pour confirmer la création d\'un compte admin.');
      return;
    }
    if (role !== 'admin' && !organizationName.trim()) {
      setCreateErr(role === 'clinicien'
        ? 'Le nom de la clinique/hôpital est requis.'
        : 'Le nom du laboratoire/institut est requis.');
      return;
    }

    try {
      const { data } = await client.post('/admin/users', {
        email, role,
        ...(role === 'admin' ? { adminPassword } : { organizationName: organizationName.trim() }),
      });
      setCreateMsg(`Compte créé pour ${data.user.email} (${data.user.role}).`);
      setEmail(''); setOrganizationName(''); setConfirmAdmin(false); setAdminPassword(''); setShowPreview(false);
      fetchUsers();
      setTimeout(() => setShowCreateModal(false), 900);
    } catch (err) {
      setCreateErr(err.response?.data?.error || 'Erreur.');
    }
  }

  async function runAction(id, path, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setOpenMenuId(null);
    setBusyId(id);
    try {
      const { data } = await client.post(`/admin/users/${id}/${path}`);
      setToast({ message: data.message, type: 'success' });
      fetchUsers();
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Erreur lors de l\'action.', type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const filtered = users
    .filter((u) => {
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchSearch = u.email.toLowerCase().includes(search.toLowerCase());
      const matchQuick = !quickFilter || QUICK_FILTERS[quickFilter].test(u);
      return matchRole && matchSearch && matchQuick;
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
      <Toast toast={toast} onClose={() => setToast(null)} />

      {showCreateModal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCreateModal(); }}>
          <div className="modal-panel">
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: 2 }}>Ajouter un utilisateur</h2>
                <p className="hint" style={{ margin: 0 }}>Un mot de passe temporaire (48h) sera généré automatiquement.</p>
              </div>
              <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Fermer">
                <IconX size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ marginTop: 16 }}>
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              <label>Rôle</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="clinicien">Clinicien</option>
                <option value="chercheur">Chercheur</option>
                <option value="admin">Admin</option>
              </select>
              {(role === 'clinicien' || role === 'chercheur') && (
                <>
                  <label style={{ marginTop: 12 }}>
                    {role === 'clinicien' ? 'Nom de la clinique / hôpital' : 'Nom du laboratoire / institut'}
                  </label>
                  <input
                    type="text"
                    value={organizationName}
                    onChange={e => setOrganizationName(e.target.value)}
                    placeholder={role === 'clinicien' ? 'ex : Institut National de Neurologie' : 'ex : LR-InstitutXYZ'}
                    required
                    autoComplete="off"
                  />
                </>
              )}
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
              {role === 'admin' && (
                <>
                  <label style={{ marginTop: 12 }}>Votre mot de passe (confirmation)</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="Ressaisissez votre mot de passe admin"
                    autoComplete="current-password"
                    required
                  />
                  <p className="hint" style={{ marginTop: 4 }}>
                    Confirmation renforcée (step-up auth) exigée pour toute création de compte admin.
                  </p>
                </>
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
                    background: 'var(--paper)',
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
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="button" className="secondary" onClick={closeCreateModal}>Annuler</button>
                <button type="submit" style={{ flex: 1 }}>Créer l'utilisateur</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <h2>Liste des utilisateurs</h2>
          <button
            type="button"
            style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px' }}
            onClick={openCreateModal}
          >
            <IconPlus size={15} color="#fff" />
            Ajouter un utilisateur
          </button>
        </div>

        {quickFilter && QUICK_FILTERS[quickFilter] && (
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10,
              padding: '6px 12px', borderRadius: 999, background: 'var(--primary-tint)',
              color: 'var(--primary-deep)', fontSize: 12.5, fontWeight: 600,
            }}
          >
            Filtre : {QUICK_FILTERS[quickFilter].label}
            <button
              type="button"
              onClick={() => setQuickFilter(null)}
              style={{
                width: 'auto', margin: 0, padding: 0, background: 'transparent', border: 'none',
                boxShadow: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, lineHeight: 1,
              }}
              aria-label="Retirer le filtre"
            >
              ×
            </button>
          </div>
        )}

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

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="subtitle">Chargement...</p>
        ) : (
          <table ref={tableRef} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '8px 6px' }}>Email</th>
                <th>Rôle</th>
                <th>Organisation</th>
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
                  <td className={!u.organization_name ? 'hint' : undefined}>{u.organization_name || '—'}</td>
                  <td><StatusBadges u={u} /></td>
                  <td>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className={!u.last_login_at ? 'hint' : undefined}>{fmtLastLogin(u.last_login_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <StatusToggle
                        user={u}
                        busy={busyId === u.id}
                        onToggle={() => runAction(
                          u.id,
                          'toggle-active',
                          `${u.is_active ? 'Désactiver' : 'Réactiver'} le compte de ${u.email} ?\n\nAvant : ${u.is_active ? 'Actif' : 'Désactivé'}\nAprès : ${u.is_active ? 'Désactivé — l\'utilisateur ne pourra plus se connecter' : 'Actif — l\'utilisateur pourra de nouveau se connecter'}`
                        )}
                      />
                      <ActionsMenu
                        user={u}
                        busy={busyId === u.id}
                        open={openMenuId === u.id}
                        isSelf={currentUser?.sub === u.id}
                        onToggleOpen={() => setOpenMenuId((cur) => (cur === u.id ? null : u.id))}
                        onHistory={() => { setOpenMenuId(null); onNavigateToUserLogs?.(u.id); }}
                        onResendPassword={() => runAction(
                          u.id,
                          'resend-temp-password',
                          u.tempPasswordStatus
                            ? `Renvoyer un nouveau mot de passe temporaire à ${u.email} ?\n\nAvant : ${u.tempPasswordStatus === 'expired' ? 'Mot de passe probablement expiré' : 'En attente de 1ère connexion'}\nAprès : Nouveau mot de passe généré, délai de 48h relancé, ancien mot de passe invalidé`
                            : `Réinitialiser le mot de passe de ${u.email} ?\n\nÀ utiliser si l'utilisateur a oublié son mot de passe après l'avoir déjà changé.\nAprès : Un nouveau mot de passe temporaire (48h) est généré et envoyé par email, l'ancien mot de passe est immédiatement invalidé`
                        )}
                        onUnlock={() => runAction(
                          u.id,
                          'unlock',
                          `Déverrouiller ${u.email} ?\n\nAvant : Verrouillé jusqu'au ${new Date(u.locked_until).toLocaleString('fr-FR')}\nAprès : Compte actif, compteur d'échecs remis à zéro`
                        )}
                        onReset2FA={() => runAction(
                          u.id,
                          'reset-2fa',
                          `Réinitialiser le 2FA de ${u.email} ?\n\nAvant : 2FA actif\nAprès : 2FA désactivé — l'utilisateur devra re-scanner un nouveau QR code à sa prochaine connexion`
                        )}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }}>Aucun utilisateur trouvé.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}