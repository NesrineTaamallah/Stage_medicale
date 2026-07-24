import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';

/**
 * Découpe une action stockée en base (ex. "DEACTIVATE_ACCOUNT:5c2617e0-...")
 * en libellé lisible + email du compte concerné, pour ne jamais afficher
 * un UUID brut à l'admin. target_email est résolu côté backend (getLogs /
 * getUserTimeline) via une jointure sur l'UUID cible.
 */
const ACTION_LABELS = {
  VIEW_USER_TIMELINE: 'Consultation timeline',
  DEACTIVATE_ACCOUNT: 'Désactivation de compte',
  REACTIVATE_ACCOUNT: 'Réactivation de compte',
  UNLOCK_ACCOUNT: 'Déverrouillage de compte',
  RESET_2FA: 'Réinitialisation 2FA',
  RESEND_TEMP_PASSWORD: 'Renvoi mot de passe temporaire',
};

function formatAction(action, targetEmail) {
  const [type] = action.split(':');
  const label = ACTION_LABELS[type] || type;
  if (targetEmail) return `${label} — ${targetEmail}`;
  return action;
}

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
  { value: 'VIEW_USER_TIMELINE', label: 'Consultation timeline utilisateur' },
  { value: 'LOGOUT', label: 'Déconnexion' },
];

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR');
}

/**
 * Parse volontairement simple (pas de lib externe) : suffisant pour repérer
 * un changement d'appareil visuellement, pas pour du fingerprinting précis.
 */
function parseUserAgent(ua) {
  if (!ua) return null;
  let browser = 'Navigateur inconnu';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  let os = 'OS inconnu';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}

function SuccessBadge({ success }) {
  return (
    <span className={`badge ${success ? 'badge-success' : 'badge-error'}`}>
      {success ? 'Succès' : 'Échec'}
    </span>
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
  const [emailFailedFilter, setEmailFailedFilter] = useState(!!initialFilters?.emailFailed);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [anomalies, setAnomalies] = useState(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);

  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const timelineRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, pageSize };
      if (emailFailedFilter) {
        params.emailFailed = true;
      } else if (actionFilter) {
        params.action = actionFilter;
      }
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
  }, [actionFilter, userIdFilter, ipFilter, dateFrom, dateTo, emailFailedFilter, page]);

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
    // La timeline est déjà le premier bloc du DOM, mais si l'admin a cliqué
    // sur une ligne loin en bas du tableau, il ne la voit pas apparaître :
    // on scrolle explicitement jusqu'à elle.
    requestAnimationFrame(() => {
      timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
  const hasAnyAnomaly = anomalies && Object.values(anomalies).some((arr) => Array.isArray(arr) && arr.length > 0);

  // Config des catégories d'anomalies : une seule source de vérité pour
  // l'icône, le libellé, la couleur de gravité et le rendu de détail,
  // utilisée à la fois par les puces-résumé et l'accordéon déplié.
  const ANOMALY_CATEGORIES = anomalies ? [
    {
      key: 'bruteForceSuccesses',
      icon: '🔓',
      title: 'Brute-force abouti',
      severity: 'high',
      description: "Connexion réussie précédée d'au moins 3 échecs pour le même compte en moins de 30 min — plus grave qu'un simple verrouillage : le mot de passe a fini par être trouvé.",
      items: anomalies.bruteForceSuccesses,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — succès {fmtDate(a.success_at)} après {a.failed_count} échec(s), depuis {a.ip_address || 'IP inconnue'}</span>
      ),
    },
    {
      key: 'reactivationImmediateUse',
      icon: '🔁',
      title: 'Réactivation puis usage immédiat',
      severity: 'high',
      description: "Compte désactivé puis réactivé par un admin différent, suivi d'une connexion dans l'heure — signal possible de collusion ou de compte détourné.",
      items: anomalies.reactivationImmediateUse,
      renderItem: (a) => (
        <span><strong>{a.target_email}</strong> — désactivé par {a.deactivated_by}, réactivé par {a.reactivated_by} le {fmtDate(a.reactivated_at)}, connecté à {fmtDate(a.login_at)}</span>
      ),
    },
    {
      key: 'bruteForceLockouts',
      icon: '🔒',
      title: 'Brute-force ciblé',
      severity: 'high',
      description: 'Comptes ayant subi un verrouillage après plusieurs échecs de connexion (24h).',
      items: anomalies.bruteForceLockouts,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — {a.attempts} tentative(s), dernière {fmtDate(a.last_attempt)}</span>
      ),
    },
    {
      key: 'credentialStuffingIps',
      icon: '🕸️',
      title: 'Énumération / credential stuffing',
      severity: 'medium',
      description: 'IP tentant de se connecter sur plusieurs comptes différents (24h).',
      items: anomalies.credentialStuffingIps,
      renderItem: (a) => (
        <span><strong>{a.ip_address}</strong> — {a.distinct_users} comptes distincts, dernière {fmtDate(a.last_attempt)}</span>
      ),
    },
    {
      key: 'totpBypassAttempts',
      icon: '🛡️',
      title: 'Contournement 2FA suspecté',
      severity: 'medium',
      description: 'Échecs de code TOTP répétés pour un même compte (24h).',
      items: anomalies.totpBypassAttempts,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — {a.failed_attempts} échec(s), dernier {fmtDate(a.last_attempt)}</span>
      ),
    },
    {
      key: 'frequent2faResets',
      icon: '♻️',
      title: 'Réinitialisations 2FA fréquentes',
      severity: 'medium',
      description: 'Signal possible de social engineering (7 jours).',
      items: anomalies.frequent2faResets,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — {a.resets} reset(s), dernier {fmtDate(a.last_reset)}</span>
      ),
    },
    {
      key: 'massExports',
      icon: '📤',
      title: 'Exports CSV répétés',
      severity: 'medium',
      description: "Au moins 5 exports des logs en moins de 10 minutes — signal possible d'exfiltration de données.",
      items: anomalies.massExports,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — {a.exports} export(s), dernier {fmtDate(a.last_export)}</span>
      ),
    },
    {
      key: 'unusualHourLogins',
      icon: '🌙',
      title: 'Connexions à horaires inhabituels',
      severity: 'low',
      description: 'Connexions réussies entre 00h et 05h (7 jours).',
      items: anomalies.unusualHourLogins,
      renderItem: (a) => (
        <span><strong>{a.email}</strong> — {fmtDate(a.created_at)} depuis {a.ip_address || 'IP inconnue'}</span>
      ),
    },
  ].filter((c) => c.items && c.items.length > 0) : [];

  const SEVERITY_COLOR = {
    high: { bg: 'var(--error-tint)', border: 'var(--error)', badge: 'badge-error' },
    medium: { bg: '#FFF7E6', border: '#E8A33D', badge: 'badge-warning' },
    low: { bg: 'var(--card)', border: 'var(--line)', badge: 'badge-muted' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Timeline utilisateur (vue détail, ouverte depuis navigation croisée ou clic sur une ligne) */}
      {(timelineLoading || timeline) && (
        <div ref={timelineRef} className="card" style={{ borderLeft: '3px solid var(--teal)', scrollMarginTop: 16 }}>
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
                      <th>Appareil</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.logs.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px' }}>{fmtDate(l.created_at)}</td>
                        <td>{formatAction(l.action, l.target_email)}</td>
                        <td>
                          {l.user_agent ? (
                            <span className="hint" style={{ fontSize: 12 }} title={l.user_agent}>
                              {parseUserAgent(l.user_agent)}
                            </span>
                          ) : (
                            <span className="hint">—</span>
                          )}
                        </td>
                        <td><SuccessBadge success={l.success} /></td>
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

      {/* Anomalies détectées */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Anomalies détectées</h2>
          <button className="secondary" onClick={() => setShowAnomalies((v) => !v)}>
            {showAnomalies ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        {showAnomalies && (
          <div style={{ marginTop: 12 }}>
            {anomaliesLoading ? (
              <p className="subtitle">Chargement des anomalies...</p>
            ) : !anomalies || !hasAnyAnomaly ? (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
                  borderRadius: 8, background: '#F0FBF6', border: '1px solid #BEE8D3',
                }}
              >
                <span style={{ fontSize: 20 }}>✅</span>
                <span style={{ fontSize: 13.5 }}>Aucune anomalie détectée actuellement. Tout est nominal.</span>
              </div>
            ) : (
              <>
                {/* Top risque : barres horizontales, triées, lecture en 3 secondes */}
                {anomalies.riskScores && anomalies.riskScores.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>
                      Top risques — priorité de traitement
                    </p>
                    <p className="hint" style={{ marginBottom: 10 }}>
                      Sujets (utilisateur ou IP) triés par score agrégé, tous patterns combinés.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {anomalies.riskScores.slice(0, 6).map((r, i) => {
                        const pct = Math.max(r.score, 4); // largeur minimale visible même pour un score faible
                        const color = r.score >= 50 ? '#D6484B' : r.score >= 20 ? '#E8A33D' : '#8CA0B3';
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ minWidth: 190, maxWidth: 190, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={r.subject}
                            >
                              {r.type === 'ip' ? '🌐 ' : '👤 '}{r.subject}
                            </span>
                            <div style={{ flex: 1, background: '#EEF1F4', borderRadius: 999, height: 20, position: 'relative', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${pct}%`, maxWidth: '100%', height: '100%', borderRadius: 999,
                                  background: color, transition: 'width 0.3s ease',
                                }}
                              />
                              <span style={{
                                position: 'absolute', left: 8, top: 0, height: '100%',
                                display: 'flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700,
                                color: r.score >= 20 ? '#fff' : 'var(--ink)',
                              }}>
                                {r.score}
                              </span>
                            </div>
                            <span className="hint" style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reasons.join(', ')}>
                              {r.reasons.join(', ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Résumé par catégorie : puces cliquables, détail replié par défaut */}
                <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>
                  Détail par type de pattern
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: expandedCategory ? 12 : 0 }}>
                  {ANOMALY_CATEGORIES.map((cat) => {
                    const colors = SEVERITY_COLOR[cat.severity];
                    const isOpen = expandedCategory === cat.key;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setExpandedCategory(isOpen ? null : cat.key)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                          border: `1px solid ${isOpen ? colors.border : 'var(--line)'}`,
                          background: isOpen ? colors.bg : 'var(--card)',
                          fontSize: 12.5, fontWeight: 600, color: 'var(--ink)',
                        }}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.title}</span>
                        <span className={`badge ${colors.badge}`} style={{ marginLeft: 2 }}>{cat.items.length}</span>
                      </button>
                    );
                  })}
                </div>

                {expandedCategory && ANOMALY_CATEGORIES.filter((c) => c.key === expandedCategory).map((cat) => (
                  <div key={cat.key} style={{ marginTop: 4 }}>
                    <p className="hint" style={{ marginBottom: 8 }}>{cat.description}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {cat.items.map((item, i) => (
                        <div
                          key={i}
                          style={{
                            background: SEVERITY_COLOR[cat.severity].bg,
                            borderLeft: `3px solid ${SEVERITY_COLOR[cat.severity].border}`,
                            borderRadius: 6, padding: '8px 10px', fontSize: 13,
                          }}
                        >
                          {cat.renderItem(item)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Flux de logs filtrable */}
      <div className="card">
        <h2>Flux de logs</h2>
        <p className="subtitle">Historique chronologique complet, filtrable.</p>

        {emailFailedFilter && (
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10,
              padding: '6px 12px', borderRadius: 999, background: 'var(--primary-tint)',
              color: 'var(--primary-deep)', fontSize: 12.5, fontWeight: 600,
            }}
          >
            Filtre : Emails échoués (création + renvoi de mot de passe)
            <button
              type="button"
              onClick={() => { setEmailFailedFilter(false); setPage(1); }}
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

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
          <select
            style={{ maxWidth: 240 }}
            value={actionFilter}
            disabled={emailFailedFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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
          <input
            type="text"
            placeholder="Filtrer par IP"
            style={{ maxWidth: 160 }}
            value={ipFilter}
            onChange={(e) => { setIpFilter(e.target.value); setPage(1); }}
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
                  <th>IP</th>
                  <th>Appareil</th>
                  <th>Statut</th>
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
                    <td>{formatAction(l.action, l.target_email)}</td>
                    <td>
                      {l.ip_address ? (
                        <span
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                          title="Filtrer sur cette IP"
                          onClick={(e) => { e.stopPropagation(); setIpFilter(l.ip_address); setPage(1); }}
                        >
                          {l.ip_address}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td>
                      {l.user_agent ? (
                        <span
                          className="hint"
                          style={{ fontSize: 12.5 }}
                          title={`User-agent complet : ${l.user_agent}${l.session_id ? `\nSession (jti) : ${l.session_id}` : ''}`}
                        >
                          {parseUserAgent(l.user_agent)}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td><SuccessBadge success={l.success} /></td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center' }}>Aucun log trouvé pour ces filtres.</td></tr>
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