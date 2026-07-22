import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UsersTab from './UsersTab';
import OverviewTab from './OverviewTab';
import LogsTab from './LogsTab';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('users'); // onglet Utilisateurs par défaut (voir spec)

  // État de navigation croisée entre onglets (cf. spec "Navigation croisée")
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
    <div className="dashboard">
      <header>
        <h1>Administration — NeuroExo-Predict
          <span className="role-badge">{user?.role}</span>
        </h1>
        <button className="secondary" onClick={logout}>Déconnexion</button>
      </header>

      <nav style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className={tab === 'overview' ? '' : 'secondary'}
          style={{ width: 'auto', margin: 0 }}
          onClick={() => setTab('overview')}
        >
          📊 Vue d'ensemble
        </button>
        <button
          className={tab === 'users' ? '' : 'secondary'}
          style={{ width: 'auto', margin: 0 }}
          onClick={() => setTab('users')}
        >
          👥 Utilisateurs
        </button>
        <button
          className={tab === 'logs' ? '' : 'secondary'}
          style={{ width: 'auto', margin: 0 }}
          onClick={() => setTab('logs')}
        >
          🔍 Logs & Sécurité
        </button>
      </nav>

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
  );
}