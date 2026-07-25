import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import {
  IconActivity, IconAlert, IconUsers, IconGlobe, IconCheckCircle,
  IconTarget, IconSearch, IconUnlock, IconRefresh, IconLock,
  IconShield, IconUpload, IconMoon, IconX,
} from '../components/Icons';

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

const SEVERITY_HEX = { high: '#D6484B', medium: '#E8A33D', low: '#8CA0B3' };
const SEVERITY_TEXT = { high: 'Élevée', medium: 'Moyenne', low: 'Faible' };

/**
 * Donut de répartition par sévérité — vue d'ensemble en 1 seconde du niveau
 * de risque global, pattern classique des dashboards de sécurité (SOC-style
 * "posture" widget : SentinelOne, Datadog Security, etc.). Le total est
 * affiché au centre.
 */
function SeverityDonut({ counts, size = 132 }) {
  const total = counts.high + counts.medium + counts.low;
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = ['high', 'medium', 'low']
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const frac = total > 0 ? counts[k] / total : 0;
      const dash = frac * circumference;
      const seg = { key: k, dash, offset };
      offset += dash;
      return seg;
    });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth="14" />
        {total === 0 ? null : segments.map((s) => (
          <circle
            key={s.key}
            cx={cx} cy={cy} r={r} fill="none"
            stroke={SEVERITY_HEX[s.key]}
            strokeWidth="14"
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">{total}</text>
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill="var(--slate)">signal{total > 1 ? 'aux' : ''}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['high', 'medium', 'low'].map((k) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: SEVERITY_HEX[k], flexShrink: 0 }} />
            <span style={{ color: 'var(--slate)', minWidth: 68 }}>{SEVERITY_TEXT[k]}</span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{counts[k]}</span>
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
  const [emailFailedFilter, setEmailFailedFilter] = useState(!!initialFilters?.emailFailed);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [anomalies, setAnomalies] = useState(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [showRiskModal, setShowRiskModal] = useState(false);

  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

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
      icon: IconUnlock,
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
      icon: IconRefresh,
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
      icon: IconLock,
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
      icon: IconGlobe,
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
      icon: IconShield,
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
      icon: IconRefresh,
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
      icon: IconUpload,
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
      icon: IconMoon,
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
      {/* Timeline utilisateur — overlay qui descend depuis le haut de l'écran,
          plutôt que de faire remonter toute la page jusqu'à un bloc en haut
          du DOM (perte de repère quand on clique loin en bas du tableau). */}
      {(timelineLoading || timeline) && (
        <div
          onClick={() => setTimeline(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(15, 23, 32, 0.35)',
            display: 'flex', justifyContent: 'center',
            padding: '64px 20px 20px',
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              borderLeft: '3px solid var(--teal)',
              width: '100%', maxWidth: 720, maxHeight: '80vh',
              overflowY: 'auto', boxShadow: '0 12px 40px rgba(15,23,32,0.25)',
              animation: 'timelineSlideDown 0.18s ease-out',
            }}
          >
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
        </div>
      )}

      {/* Anomalies détectées — en-tête + bascule d'affichage */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Anomalies détectées</h2>
            <p className="subtitle" style={{ marginTop: 2 }}>
              Détection automatique de comportements suspects sur les 24h / 7 derniers jours.
            </p>
          </div>
          <button className="secondary" onClick={() => setShowAnomalies((v) => !v)}>
            {showAnomalies ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </div>

      {showAnomalies && (
        anomaliesLoading ? (
          <div className="card"><p className="subtitle" style={{ margin: 0 }}>Chargement des anomalies...</p></div>
        ) : !anomalies || !hasAnyAnomaly ? (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="icon" style={{ color: 'var(--success)' }}><IconCheckCircle size={20} /></span>
            <span style={{ fontSize: 13.5 }}>Aucune anomalie détectée actuellement. Tout est nominal.</span>
          </div>
        ) : (() => {
          const highCount = ANOMALY_CATEGORIES.filter((c) => c.severity === 'high').reduce((s, c) => s + c.items.length, 0);
          const mediumCount = ANOMALY_CATEGORIES.filter((c) => c.severity === 'medium').reduce((s, c) => s + c.items.length, 0);
          const lowCount = ANOMALY_CATEGORIES.filter((c) => c.severity === 'low').reduce((s, c) => s + c.items.length, 0);
          const totalSignals = highCount + mediumCount + lowCount;
          const riskScores = anomalies.riskScores || [];
          const accountsInvolved = new Set(riskScores.filter((r) => r.type === 'user').map((r) => r.subject)).size;
          const ipsInvolved = new Set(riskScores.filter((r) => r.type === 'ip').map((r) => r.subject)).size;
          const topScore = riskScores.length > 0 ? Math.max(...riskScores.map((r) => r.score)) : 0;

          return (
            <>
              {/* ── 1. Bandeau KPI : chaque indicateur est sa propre carte ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
                {[
                  { label: 'Signaux au total', value: totalSignals, Icon: IconActivity, accent: 'var(--primary)' },
                  { label: 'Risque le plus élevé', value: topScore, Icon: IconAlert, accent: topScore >= 20 ? SEVERITY_HEX.medium : SEVERITY_HEX.low },
                  { label: 'Comptes concernés', value: accountsInvolved, Icon: IconUsers, accent: 'var(--teal)' },
                  { label: 'IP suspectes', value: ipsInvolved, Icon: IconGlobe, accent: SEVERITY_HEX.medium },
                ].map((kpi) => (
                  <div key={kpi.label} className="card" style={{ padding: '16px 18px' }}>
                    <span className="icon" style={{ color: kpi.accent }}><kpi.Icon size={19} /></span>
                    <p style={{ margin: '10px 0 2px', fontSize: 26, fontWeight: 700, color: 'var(--ink)' }}>{kpi.value}</p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--slate)' }}>{kpi.label}</p>
                  </div>
                ))}
              </div>

              {/* ── 2. Répartition par sévérité — bloc dédié ── */}
              <div className="card">
                <p style={{ margin: '0 0 14px', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                  Répartition par sévérité
                </p>
                <SeverityDonut counts={{ high: highCount, medium: mediumCount, low: lowCount }} />
              </div>

              {/* ── 3. Top risques — bloc dédié, ouvre une fenêtre avec le détail des comptes ── */}
              {riskScores.length > 0 && (
                <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                      Top risques — priorité de traitement
                    </p>
                    <p className="hint" style={{ margin: 0 }}>
                      {riskScores.length} sujet(s) (compte ou IP) classé(s) par score agrégé, tous patterns combinés.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ width: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    onClick={() => setShowRiskModal(true)}
                  >
                    <IconTarget size={16} />
                    Voir le classement
                  </button>
                </div>
              )}

              {/* ── 4. Détail par type de pattern — bloc dédié, grille de tuiles ── */}
              <div className="card">
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                  Détail par type de pattern
                </p>
                <p className="hint" style={{ marginBottom: 14 }}>
                  Cliquez une carte pour afficher le détail des occurrences.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                  {ANOMALY_CATEGORIES.map((cat) => {
                    const colors = SEVERITY_COLOR[cat.severity];
                    const CatIcon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setExpandedCategory(cat.key)}
                        style={{
                          textAlign: 'left', cursor: 'pointer', width: '100%', margin: 0,
                          padding: '14px 16px', borderRadius: 10,
                          background: 'var(--paper)',
                          border: '1px solid var(--line)',
                          boxShadow: 'none',
                          display: 'flex', flexDirection: 'column', gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span className="icon" style={{ color: colors.border }}><CatIcon size={18} /></span>
                          <span className={`badge ${colors.badge}`}>{cat.items.length}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{cat.title}</p>
                        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--slate)', lineHeight: 1.4 }}>{cat.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Fenêtre : détail des occurrences d'un type de pattern ── */}
              {expandedCategory && ANOMALY_CATEGORIES.filter((c) => c.key === expandedCategory).map((cat) => {
                const CatIcon = cat.icon;
                const colors = SEVERITY_COLOR[cat.severity];
                return (
                  <div
                    key={cat.key}
                    className="modal-overlay"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setExpandedCategory(null); }}
                  >
                    <div className="modal-panel" style={{ maxWidth: 560 }}>
                      <div className="modal-header">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          <span
                            className="icon"
                            style={{
                              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                              background: colors.bg, color: colors.border,
                            }}
                          >
                            <CatIcon size={18} />
                          </span>
                          <div>
                            <h2 style={{ marginBottom: 2 }}>{cat.title}</h2>
                            <p className="hint" style={{ margin: 0 }}>{cat.description}</p>
                          </div>
                        </div>
                        <button type="button" className="modal-close" onClick={() => setExpandedCategory(null)} aria-label="Fermer">
                          <IconX size={18} />
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px' }}>
                        <span className={`badge ${colors.badge}`}>{cat.items.length} occurrence{cat.items.length > 1 ? 's' : ''}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: '52vh', overflowY: 'auto' }}>
                        {cat.items.map((item, i) => (
                          <div
                            key={i}
                            style={{
                              background: 'var(--paper)',
                              borderLeft: `3px solid ${colors.border}`,
                              borderRadius: 8, padding: '10px 12px', fontSize: 13,
                            }}
                          >
                            {cat.renderItem(item)}
                          </div>
                        ))}
                        {cat.items.length === 0 && (
                          <p className="hint" style={{ margin: 0 }}>Aucune occurrence.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* ── Fenêtre : classement complet des comptes/IP à risque ── */}
              {showRiskModal && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowRiskModal(false); }}>
                  <div className="modal-panel" style={{ maxWidth: 620 }}>
                    <div className="modal-header">
                      <div>
                        <h2 style={{ marginBottom: 2 }}>Top risques — priorité de traitement</h2>
                        <p className="hint" style={{ margin: 0 }}>
                          Sujets (compte ou IP) classés par score agrégé, tous patterns combinés.
                        </p>
                      </div>
                      <button type="button" className="modal-close" onClick={() => setShowRiskModal(false)} aria-label="Fermer">
                        <IconX size={18} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                      {riskScores.map((r, i) => {
                        const sev = r.score >= 50 ? 'high' : r.score >= 20 ? 'medium' : 'low';
                        const pct = Math.min(100, Math.max((r.score / Math.max(topScore, 1)) * 100, 6));
                        const SubjectIcon = r.type === 'ip' ? IconGlobe : IconUsers;
                        return (
                          <div
                            key={i}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 14,
                              padding: '10px 14px', borderRadius: 10,
                              background: 'var(--paper)',
                              borderLeft: `3px solid ${SEVERITY_HEX[sev]}`,
                            }}
                          >
                            <span
                              style={{
                                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                background: 'var(--card)', border: '1px solid var(--line)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11.5, fontWeight: 700, color: 'var(--slate)',
                              }}
                            >
                              {i + 1}
                            </span>
                            <div style={{ flex: '0 0 230px', minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.subject}>
                                <SubjectIcon size={13} color="var(--slate)" />
                                {r.subject}
                              </p>
                              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--slate)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reasons.join(', ')}>
                                {r.reasons.join(' · ')}
                              </p>
                            </div>
                            <div style={{ flex: 1, background: '#EEF1F4', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: SEVERITY_HEX[sev] }} />
                            </div>
                            <span
                              className={`badge ${sev === 'high' ? 'badge-error' : sev === 'medium' ? 'badge-warning' : 'badge-muted'}`}
                              style={{ flexShrink: 0, minWidth: 34, textAlign: 'center' }}
                            >
                              {r.score}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()
      )}

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