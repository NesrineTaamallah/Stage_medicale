import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

const ACTION_OPTIONS = [
  { value: '', label: 'Toutes les actions' },
  { value: 'LOGIN', label: 'Connexion (toutes)' },
  { value: 'LOGIN_ATTEMPT_LOCKED', label: 'Verrouillage suite échecs' },
  { value: 'LOGIN_PASSWORD_OK', label: 'Mot de passe validé' },
  { value: 'TOTP', label: '2FA / TOTP' },
  { value: 'CREATE_USER', label: 'Création de compte' },
  { value: 'RESEND_TEMP_PASSWORD', label: 'Renvoi mot de passe temporaire' },
  { value: 'RESET_2FA', label: 'Réinitialisation 2FA' },
  { value: 'UNLOCK_ACCOUNT', label: 'Déverrouillage de compte' },
  { value: 'DEACTIVATE_ACCOUNT', label: 'Désactivation' },
  { value: 'REACTIVATE_ACCOUNT', label: 'Réactivation' },
  { value: 'LOGOUT', label: 'Déconnexion' },
];

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR');
}

function SuccessBadge({ success }) {
  return (
    <span className={`badge ${success ? 'badge-success' : 'badge-error'}`}>
      {success ? 'Succès' : 'Échec'}
    </span>
  );
}

function AnomalySection({ title, description, items, renderItem, emptyText }) {
  if (!items || items.length === 0) {
    return null; // n'afficher que les anomalies réellement détectées
  }
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{title}</p>
      <p className="hint" style={{ marginBottom: 8 }}>{description}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              background: 'var(--error-tint)',
              borderLeft: '3px solid var(--error)',
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 13,
            }}
          >
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogsTab({ initialFilters, focusUserId, onFocusUserHandled }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [actionFilter, setActionFilter] = useState(initialFilters?.action || '');
  const [userIdFilter, setUserIdFilter] = useState(initialFilters?.userId || '');
  const [ipFilter, setIpFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [anomalies, setAnomalies] = useState(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [showAnomalies, setShowAnomalies] = useState(true);

  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, pageSize };
      if (actionFilter) params.action = actionFilter;
      if (userIdFilter) params.userId = userIdFilter;
      if (ipFilter) params.ip = ipFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await client.get('/admin/logs', { params });
      setLogs(data.rows);
      setTotal(data.total);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de chargement des logs.');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, userIdFilter, ipFilter, dateFrom, dateTo, page]);

  const fetchAnomalies = useCallback(async () => {
    setAnomaliesLoading(true);
    try {
      const { data } = await client.get('/admin/logs/anomalies');
      setAnomalies(data);
    } catch {
      setAnomalies(null);
    } finally {
      setAnomaliesLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchAnomalies(); }, [fetchAnomalies]);

  // Navigation croisée : arrivée depuis un autre onglet avec un user ciblé
  useEffect(() => {
    if (focusUserId) {
      openTimeline(focusUserId);
      onFocusUserHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUserId]);

  async function openTimeline(userId) {
    setTimelineLoading(true);
    setTimeline(null);
    try {
      const { data } = await client.get(`/admin/logs/user/${userId}`);
      setTimeline(data);
    } catch (err) {
      setTimeline({ error: err.response?.data?.error || 'Utilisateur introuvable.' });
    } finally {
      setTimelineLoading(false);
    }
  }

  function resetFilters() {
    setActionFilter(''); setUserIdFilter(''); setIpFilter('');
    setDateFrom(''); setDateTo(''); setPage(1);
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (userIdFilter) params.set('userId', userIdFilter);
    if (ipFilter) params.set('ip', ipFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    // withCredentials est requis (cookie httpOnly) : on ouvre l'URL absolue du backend
    window.open(`http://localhost:4000/admin/logs/export?${params.toString()}`, '_blank');
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const hasAnyAnomaly = anomalies && Object.values(anomalies).some((arr) => arr.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Timeline utilisateur (vue détail, ouverte depuis navigation croisée ou clic sur une ligne) */}
      {(timelineLoading || timeline) && (
        <div className="card" style={{ borderLeft: '3px solid var(--teal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h2>
              {timelineLoading ? 'Chargement de la timeline...' : timeline?.error ? 'Erreur' : `Timeline — ${timeline.user.email}`}
            </h2>
            <button className="secondary" onClick={() => setTimeline(null)}>Fermer</button>
          </div>
          {timeline?.error && <p className="error">{timeline.error}</p>}
          {timeline?.user && (
            <>
              <p className="hint" style={{ marginBottom: 12 }}>Rôle : {timeline.user.role}</p>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                      <th style={{ padding: '6px' }}>Date</th>
                      <th>Action</th>
                      <th>Statut</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.logs.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px' }}>{fmtDate(l.created_at)}</td>
                        <td>{l.action}</td>
                        <td><SuccessBadge success={l.success} /></td>
                        <td>{l.ip_address || '—'}</td>
                      </tr>
                    ))}
                    {timeline.logs.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 12, textAlign: 'center' }}>Aucune activité enregistrée.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Alertes & anomalies */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Alertes &amp; anomalies</h2>
          <button className="secondary" onClick={() => setShowAnomalies((s) => !s)}>
            {showAnomalies ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        {showAnomalies && (
          <div style={{ marginTop: 12 }}>
            {anomaliesLoading ? (
              <p className="subtitle">Analyse des patterns en cours...</p>
            ) : !hasAnyAnomaly ? (
              <p className="hint">Aucune anomalie détectée sur la période analysée. 👍</p>
            ) : (
              <>
                <AnomalySection
                  title="Brute-force ciblé"
                  description="Comptes ayant subi un verrouillage après plusieurs échecs de connexion (24h)."
                  items={anomalies.bruteForceLockouts}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.email}</strong> — {a.attempts} tentative(s), dernière {fmtDate(a.last_attempt)}
                    </span>
                  )}
                />
                <AnomalySection
                  title="Énumération / credential stuffing"
                  description="IP tentant de se connecter sur plusieurs comptes différents (24h)."
                  items={anomalies.credentialStuffingIps}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.ip_address}</strong> — {a.distinct_users} comptes distincts, dernière {fmtDate(a.last_attempt)}
                    </span>
                  )}
                />
                <AnomalySection
                  title="Contournement 2FA suspecté"
                  description="Échecs de code TOTP répétés pour un même compte (24h)."
                  items={anomalies.totpBypassAttempts}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.email}</strong> — {a.failed_attempts} échec(s), dernier {fmtDate(a.last_attempt)}
                    </span>
                  )}
                />
                <AnomalySection
                  title="Réinitialisations 2FA fréquentes"
                  description="Signal possible de social engineering (7 jours)."
                  items={anomalies.frequent2faResets}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.email}</strong> — {a.resets} reset(s), dernier {fmtDate(a.last_reset)}
                    </span>
                  )}
                />
                <AnomalySection
                  title="Activité admin anormalement élevée"
                  description="Création massive de comptes hors pattern habituel (1h)."
                  items={anomalies.massAdminActivity}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.admin_email}</strong> — {a.created_count} comptes créés en moins d'1h
                    </span>
                  )}
                />
                <AnomalySection
                  title="Connexions à horaires inhabituels"
                  description="Connexions réussies entre 00h et 05h (7 jours)."
                  items={anomalies.unusualHourLogins}
                  renderItem={(a) => (
                    <span>
                      <strong>{a.email}</strong> — {fmtDate(a.created_at)} depuis {a.ip_address || 'IP inconnue'}
                    </span>
                  )}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Flux de logs filtrable */}
      <div className="card">
        <h2>Flux de logs</h2>
        <p className="subtitle">Historique chronologique complet, filtrable.</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
          <select style={{ maxWidth: 240 }} value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            style={{ maxWidth: 180 }}
            placeholder="Filtrer par IP..."
            value={ipFilter}
            onChange={(e) => { setIpFilter(e.target.value); setPage(1); }}
          />
          <input
            type="date"
            style={{ maxWidth: 160 }}
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
          <input
            type="date"
            style={{ maxWidth: 160 }}
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
          <button className="secondary" onClick={resetFilters}>Réinitialiser</button>
          <button className="secondary" onClick={handleExport}>Exporter en CSV</button>
        </div>

        {userIdFilter && (
          <p className="hint" style={{ marginBottom: 10 }}>
            Filtré sur un utilisateur spécifique.{' '}
            <button className="secondary" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={() => setUserIdFilter('')}>
              Retirer ce filtre
            </button>
          </p>
        )}

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="subtitle">Chargement...</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '8px 6px' }}>Date</th>
                  <th>Utilisateur</th>
                  <th>Action</th>
                  <th>Statut</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    style={{ borderBottom: '1px solid var(--line)', cursor: l.user_id ? 'pointer' : 'default' }}
                    onClick={() => l.user_id && openTimeline(l.user_id)}
                  >
                    <td style={{ padding: '8px 6px' }}>{fmtDate(l.created_at)}</td>
                    <td>{l.user_email || '—'}</td>
                    <td>{l.action}</td>
                    <td><SuccessBadge success={l.success} /></td>
                    <td>{l.ip_address || '—'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center' }}>Aucun log trouvé pour ces filtres.</td></tr>
                )}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span className="hint" style={{ margin: 0 }}>{total} résultat(s)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</button>
                <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>Page {page} / {totalPages}</span>
                <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
