import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UsersTab from './UsersTab';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('users'); // onglet Utilisateurs par défaut (voir spec)

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
        <div className="card"><p className="subtitle">Onglet Vue d'ensemble — à venir.</p></div>
      )}
      {tab === 'users' && <UsersTab />}
      {tab === 'logs' && (
        <div className="card"><p className="subtitle">Onglet Logs & Sécurité — à venir.</p></div>
      )}
    </div>
  );
}