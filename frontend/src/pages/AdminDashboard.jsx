import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UsersTab from './UsersTab';
import OverviewTab from './OverviewTab';
import LogsTab from './LogsTab';
import { IconChart, IconUsers, IconSearch, IconLogout } from '../components/Icons';

const NAV_ITEMS = [
  { key: 'overview', Icon: IconChart, label: "Vue d'ensemble" },
  { key: 'users', Icon: IconUsers, label: 'Utilisateurs' },
  { key: 'logs', Icon: IconSearch, label: 'Logs & sécurité' },
];

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('users');

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

  const current = NAV_ITEMS.find((i) => i.key === tab);

  return (
    <div style={{ display: 'flex', minHeight: '100svh' }}>
      {/* ---------- Sidebar ---------- */}
      <aside
        style={{
          width: 236,
          flexShrink: 0,
          background: 'var(--card)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 14px',
        }}
      >
        <div style={{ padding: '0 8px', marginBottom: 8 }}>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              fontSize: 16,
              color: 'var(--ink)',
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            NeuroExo‑Predict
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--slate-soft)', margin: '2px 0 0', letterSpacing: 0.3 }}>
            Console d'administration
          </p>
        </div>

        <div style={{ padding: '10px 8px 18px' }}>
          <span className="role-badge">{user?.role}</span>
          {user?.email && (
            <p style={{ fontSize: 12, color: 'var(--slate)', margin: '8px 0 0', wordBreak: 'break-all' }}>
              {user.email}
            </p>
          )}
        </div>

        <hr className="hairline" style={{ margin: '0 0 14px' }} />

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                style={{
                  width: '100%',
                  margin: 0,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 10px',
                  borderRadius: 3,
                  fontSize: 13,
                  fontWeight: 600,
                  background: active ? 'var(--teal-tint)' : 'transparent',
                  color: active ? 'var(--teal-deep)' : 'var(--slate)',
                  boxShadow: 'none',
                  border: 'none',
                  borderLeft: active ? '2px solid var(--teal)' : '2px solid transparent',
                }}
              >
                <item.Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <hr className="hairline" style={{ margin: '14px 0' }} />

        <button
          className="secondary"
          onClick={logout}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <IconLogout size={14} />
          Déconnexion
        </button>
      </aside>

      {/* ---------- Contenu ---------- */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dashboard" style={{ maxWidth: 980 }}>
          <header style={{ border: 'none', paddingBottom: 0, marginBottom: 24, alignItems: 'baseline' }}>
            <div>
              <p className="eyebrow" style={{ marginBottom: 6 }}>Administration</p>
              <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 21 }}>
                {current && <current.Icon size={19} color="var(--teal-deep)" />}
                {current?.label}
              </h1>
            </div>
          </header>

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
    </div>
  );
}