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

/** "Nesrine Taamallah" → "NT", pour l'avatar rond du pied de sidebar. */
function initialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Dimanche 2 août 2026" — capitalisée, format lu par toute l'app côté admin. */
function todayFr() {
  const str = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return str.charAt(0).toUpperCase() + str.slice(1);
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
          background: 'linear-gradient(180deg, #16333A, #122A30 70%)',
          display: 'flex',
          flexDirection: 'column',
          height: '100svh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 10,
        }}
      >
        <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={38} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#F1FAFB', margin: 0, lineHeight: 1.25 }}>
                NeuroExo-Predict
              </p>
              <p style={{ fontSize: 11.5, color: '#8FB6BD', margin: 0 }}>
                Registre clinique
              </p>
            </div>
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
                  fontWeight: 500,
                  textAlign: 'left',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: active ? '#F1FAFB' : '#B9D9DE',
                  boxShadow: 'none',
                  border: 'none',
                  borderLeft: active ? '3px solid var(--highlight)' : '3px solid transparent',
                  borderRadius: 8,
                }}
              >
                <item.Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: 'var(--teal-tint)', color: 'var(--teal-deep)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12.5,
          }}>
            {initialsFromName(displayName)}
          </div>
          <div style={{ lineHeight: 1.25, overflow: 'hidden', flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12.8, fontWeight: 600, color: '#F1FAFB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayName}
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: '#8FB6BD', wordBreak: 'break-all' }}>
              {user?.email}
            </p>
          </div>
          <button
            onClick={logout}
            title="Déconnexion"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#8FB6BD', width: 30, height: 30, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: 'none', padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(193,80,61,0.18)'; e.currentTarget.style.color = '#F2A392'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8FB6BD'; }}
          >
            <IconLogout size={15} />
          </button>
        </div>
      </aside>

      {/* ---------- Contenu ----------
          marginLeft = largeur de la sidebar fixed, pour ne pas passer dessous. */}
      <div style={{ marginLeft: SIDEBAR_WIDTH, minWidth: 0 }}>
        {/* En-tête de bienvenue, fixe au défilement (position: sticky) : reste
            visible en haut du contenu quel que soit l'onglet ou le scroll. */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            background: 'linear-gradient(180deg, #F3FBFD, var(--paper))',
            borderBottom: '1px solid var(--line)',
            padding: '20px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, color: 'var(--ink)' }}>
              Bonjour, {displayName} <span style={{ fontWeight: 400 }}>👋</span>
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--slate)' }}>
              {todayFr()}
            </p>
          </div>

          {/* Rappel visuel explicite : cet espace est réservé aux comptes admin. */}
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              background: 'var(--primary-tint)', color: 'var(--primary-deep)',
              fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
              flexShrink: 0, marginTop: 2,
            }}
          >
            <IconShield size={13} />
            Espace Administrateur
          </div>
        </header>

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
