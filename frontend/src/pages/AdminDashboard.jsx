import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import BrandMark from '../components/BrandMark';
import UsersTab from './UsersTab';
import OverviewTab from './OverviewTab';
import LogsTab from './LogsTab';
import CommunicationsTab from './CommunicationsTab';
import { IconChart, IconUsers, IconSearch, IconLogout, IconShield, IconMail } from '../components/Icons';

const SIDEBAR_WIDTH = 248;

const NAV_ITEMS = [
  { key: 'overview', Icon: IconChart, label: "Vue d'Ensemble" },
  { key: 'users', Icon: IconUsers, label: 'Utilisateurs' },
  { key: 'communications', Icon: IconMail, label: 'Communications' },
  { key: 'logs', Icon: IconSearch, label: 'Journaux' },
];

/**
 * Extrait un "Prénom Nom" présentable à partir d'un email du type
 * prenom.nom@domaine.tld (format utilisé par tous les comptes du registre).
 * Pas de casse-tête si le format ne matche pas : on retombe sur la partie
 * locale de l'email telle quelle plutôt que d'afficher un email brut.
 */
function displayNameFromEmail(email) {
  if (!email) return 'Administrateur';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('overview');

  const [logsFilters, setLogsFilters] = useState({});
  const [focusUserId, setFocusUserId] = useState(null);
  const [usersQuickFilter, setUsersQuickFilter] = useState(null);

  function goToLogs(filters) {
    setLogsFilters(filters || {});
    setTab('logs');
  }

  function goToUserTimeline(userId) {
    setFocusUserId(userId);
    setTab('logs');
  }

  // Boutons "revue groupée" de la Vue d'ensemble : envoie directement vers
  // l'onglet Utilisateurs avec un filtre rapide déjà appliqué, plutôt que de
  // laisser l'admin re-chercher les comptes un par un.
  function goToUsersFilter(quickFilter) {
    setUsersQuickFilter(quickFilter);
    setTab('users');
  }

  const displayName = displayNameFromEmail(user?.email);

  return (
    <div style={{ minHeight: '100svh', background: 'var(--paper)' }}>
      {/* ---------- Barre latérale gauche ----------
          En position fixed (et non sticky) : plus fiable ici, la sidebar
          reste plaquée au viewport quel que soit le contexte de défilement
          du contenu à droite, qui lui défile normalement sous elle. */}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          background: 'var(--card)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          height: '100svh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 10,
        }}
      >
        <div style={{ padding: '22px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={38} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', margin: 0, lineHeight: 1.25 }}>
                NeuroExo-Predict
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--slate)', margin: 0 }}>
                Institut National de Neurologie
              </p>
            </div>
          </div>

          {/* Rappel visuel explicite : cet espace est réservé aux comptes admin. */}
          <div
            style={{
              marginTop: 14,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 999,
              background: 'var(--primary-tint)', color: 'var(--primary)',
              fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
            }}
          >
            <IconShield size={13} />
            Espace Administrateur
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 12px', flex: 1, overflowY: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                style={{
                  width: '100%',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  textAlign: 'left',
                  background: active ? 'var(--primary-tint)' : 'transparent',
                  color: active ? 'var(--primary)' : 'var(--slate)',
                  boxShadow: 'none',
                  border: 'none',
                  borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                  borderRadius: 8,
                }}
              >
                <item.Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--slate)' }}>Bienvenue,</p>
          <p style={{ margin: '2px 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{displayName}</p>
          <p style={{ margin: '0 0 12px', fontSize: 11.5, color: 'var(--slate-soft)', wordBreak: 'break-all' }}>{user?.email}</p>
          <button
            className="secondary"
            onClick={logout}
            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 14px' }}
          >
            <IconLogout size={14} />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ---------- Contenu ----------
          marginLeft = largeur de la sidebar fixed, pour ne pas passer dessous. */}
      <div style={{ marginLeft: SIDEBAR_WIDTH, minWidth: 0 }}>
        <div className="dashboard" style={{ maxWidth: 1120 }}>
          {tab === 'overview' && (
            <OverviewTab
              onNavigateToLogs={goToLogs}
              onNavigateToUser={goToUserTimeline}
              onNavigateToUsersFilter={goToUsersFilter}
            />
          )}
          {tab === 'users' && (
            <UsersTab
              onNavigateToUserLogs={goToUserTimeline}
              initialQuickFilter={usersQuickFilter}
              onQuickFilterHandled={() => setUsersQuickFilter(null)}
            />
          )}
          {tab === 'communications' && <CommunicationsTab />}
          {tab === 'logs' && (
            <LogsTab
              initialFilters={logsFilters}
              focusUserId={focusUserId}
              onFocusUserHandled={() => setFocusUserId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
