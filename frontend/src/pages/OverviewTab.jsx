import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

const ACTION_LABELS = {
  CREATE_USER: 'Création de compte',
  CREATE_USER_EMAIL_FAILED: 'Création de compte (email échoué)',
  RESET_2FA: 'Réinitialisation 2FA',
  RESEND_TEMP_PASSWORD: 'Renvoi mot de passe temporaire',
  RESEND_TEMP_PASSWORD_EMAIL_FAILED: 'Renvoi mot de passe (email échoué)',
  UNLOCK_ACCOUNT: 'Déverrouillage de compte',
  DEACTIVATE_ACCOUNT: 'Désactivation de compte',
  REACTIVATE_ACCOUNT: 'Réactivation de compte',
};

function actionLabel(action) {
  const base = action.split(':')[0];
  return ACTION_LABELS[base] || base;
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function StatCard({ label, value, tone }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '16px 18px',
        flex: '1 1 140px',
        minWidth: 140,
      }}
    >
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>
        {label}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 700,
          margin: '6px 0 0',
          color: tone === 'error' ? 'var(--error)' : tone === 'amber' ? 'var(--amber)' : 'var(--ink)',
        }}
      >
        {value}
      </p>
    </div>
  );
}

export default function OverviewTab({ onNavigateToLogs, onNavigateToUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/admin/overview');
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || "Erreur de chargement de la vue d'ensemble.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 60000); // rafraîchissement auto — vue "état de santé"
    return () => clearInterval(interval);
  }, [fetchOverview]);

  if (loading && !data) {
    return <div className="card"><p className="subtitle">Chargement de la vue d'ensemble...</p></div>;
  }
  if (error) {
    return <div className="card"><p className="error">{error}</p></div>;
  }
  if (!data) return null;

  const hasActiveAlert = data.alerts.lockoutsLastHour > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Alerte proéminente si activité de verrouillage récente */}
      {hasActiveAlert && (
        <div
          className="card"
          style={{ borderLeft: '4px solid var(--error)', cursor: 'pointer' }}
          onClick={() => onNavigateToLogs?.({ action: 'LOGIN_ATTEMPT_LOCKED' })}
        >
          <p style={{ margin: 0, color: 'var(--error)', fontWeight: 600 }}>
            ⚠ {data.alerts.lockoutsLastHour} compte(s) verrouillé(s) dans la dernière heure
          </p>
          <p className="hint" style={{ marginTop: 4 }}>Cliquez pour investiguer dans les logs.</p>
        </div>
      )}

      {/* Compteurs clés */}
      <div className="card">
        <h2>Compteurs clés</h2>
        <p className="subtitle" style={{ marginBottom: 16 }}>État général des comptes, à date.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Utilisateurs" value={data.totalUsers} />
          <StatCard label="Admins" value={data.roleCounts.admin} />
          <StatCard label="Cliniciens" value={data.roleCounts.clinicien} />
          <StatCard label="Chercheurs" value={data.roleCounts.chercheur} />
          <StatCard label="Jamais connectés" value={data.neverLoggedIn} tone={data.neverLoggedIn > 0 ? 'amber' : undefined} />
          <StatCard label="Verrouillés" value={data.lockedNow} tone={data.lockedNow > 0 ? 'error' : undefined} />
          <StatCard label="Désactivés" value={data.inactiveAccounts} />
        </div>
      </div>

      {/* Statut email */}
      <div className="card">
        <h2>Statut du service email</h2>
        {data.emailStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <span className={`badge ${data.emailStatus.success ? 'badge-success' : 'badge-error'}`}>
              {data.emailStatus.success ? 'Dernier envoi réussi' : 'Dernier envoi échoué'}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {actionLabel(data.emailStatus.action)} — {timeAgo(data.emailStatus.at)}
            </span>
          </div>
        ) : (
          <p className="subtitle">Aucun envoi d'email enregistré pour l'instant.</p>
        )}
      </div>

      {/* Comptes en attente de 1ère connexion > 24h */}
      <div className="card">
        <h2>Comptes en attente de 1ère connexion (&gt; 24h)</h2>
        <p className="subtitle" style={{ marginBottom: 16 }}>
          Le mot de passe temporaire est valable 48h : ces comptes risquent une expiration silencieuse.
        </p>
        {data.pendingFirstLoginOver24h.length === 0 ? (
          <p className="hint">Aucun compte concerné actuellement.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '8px 6px' }}>Email</th>
                <th>Rôle</th>
                <th>Créé le</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.pendingFirstLoginOver24h.map((u) => {
                const hoursElapsed = (Date.now() - new Date(u.temp_password_created_at || u.created_at).getTime()) / 3600000;
                const expired = hoursElapsed > 48;
                return (
                  <tr
                    key={u.id}
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    onClick={() => onNavigateToUser?.(u.id)}
                  >
                    <td style={{ padding: '8px 6px' }}>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <span className={`badge ${expired ? 'badge-error' : 'badge-warning'}`}>
                        {expired ? 'Mot de passe probablement expiré' : 'En attente'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Activité admin récente */}
      <div className="card">
        <h2>Dernières actions admin</h2>
        {data.recentActivity.length === 0 ? (
          <p className="hint">Aucune action récente.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {data.recentActivity.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--line)',
                  fontSize: 13.5,
                }}
              >
                <span>
                  {actionLabel(a.action)}
                  {a.user_email && <span className="hint" style={{ marginLeft: 8 }}>({a.user_email})</span>}
                </span>
                <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
        <button className="secondary" style={{ marginTop: 14 }} onClick={() => onNavigateToLogs?.({})}>
          Voir tous les logs →
        </button>
      </div>
    </div>
  );
}
