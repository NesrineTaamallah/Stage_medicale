import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import BrandMark from '../components/BrandMark';
import UsersTab from './UsersTab';
import OverviewTab from './OverviewTab';
import LogsTab from './LogsTab';
import { IconChart, IconUsers, IconSearch, IconLogout } from '../components/Icons';

const NAV_ITEMS = [
  { key: 'overview', Icon: IconChart, label: "Vue d'Ensemble" },
  { key: 'users', Icon: IconUsers, label: 'Utilisateurs' },
  { key: 'logs', Icon: IconSearch, label: 'Journaux' },
];

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('overview');

  const [logsFilters, setLogsFilters] = useState({});
  const [focusUserId, setFocusUserId] = useState(null);

  function goToLogs(filters) {
    setLogsFilters(filters || {});
    setTab('logs');
  }

  function goToUserTimeline(userId) {
    setFocusUserId(userId);
    setTab('logs');
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--paper)' }}>
      {/* ---------- Barre supérieure ---------- */}
      <header style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
        <div
          style={{
            maxWidth: 1120, margin: '0 auto', padding: '16px 24px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={38} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', margin: 0, lineHeight: 1.25 }}>
                Admin Dashboard
              </p>
              <p style={{ fontSize: 12, color: 'var(--slate)', margin: 0 }}>
                Plateforme Médicale · Gestion Administrative
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Admin User</p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--slate-soft)' }}>{user?.email}</p>
            </div>
            <button
              className="secondary"
              onClick={logout}
              style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}
            >
              <IconLogout size={14} />
              Déconnexion
            </button>
          </div>
        </div>

        {/* ---------- Onglets horizontaux ---------- */}
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px' }}>
          <nav style={{ display: 'flex', gap: 6 }}>
            {NAV_ITEMS.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  style={{
                    width: 'auto',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '11px 6px',
                    fontSize: 13.5,
                    fontWeight: 600,
                    background: 'transparent',
                    color: active ? 'var(--primary)' : 'var(--slate)',
                    boxShadow: 'none',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                    borderRadius: 0,
                  }}
                >
                  <item.Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ---------- Contenu ---------- */}
      <div className="dashboard" style={{ maxWidth: 1120 }}>
        {tab === 'overview' && (
          <OverviewTab onNavigateToLogs={goToLogs} onNavigateToUser={goToUserTimeline} />
        )}
        {tab === 'users' && <UsersTab onNavigateToUserLogs={goToUserTimeline} />}
        {tab === 'logs' && (
          <LogsTab
            initialFilters={logsFilters}
            focusUserId={focusUserId}
            onFocusUserHandled={() => setFocusUserId(null)}
          />
        )}
      </div>
    </div>
  );
}
