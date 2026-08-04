import { useAuth } from '../context/AuthContext';

import ClinicienDashboard from './ClinicienDashboard';


export default function UserDashboard() {
  
  const { user, logout } = useAuth();
  if (user?.role === 'clinicien') return <ClinicienDashboard />;


  return (
    <div className="dashboard">
      <header>
        <h1>Registre clinique — NeuroExo-Predict
            <span className="role-badge">{user?.role}</span>
        </h1>
        <button className="secondary" onClick={logout}>Déconnexion</button>
      </header>

      <div className="card">
        <h2>Bienvenue{user?.email ? `, ${user.email}` : ''}</h2>
        <p className="subtitle">
          Connecté en tant que <strong>{user?.role}</strong>.
        </p>

        {user?.role === 'clinicien' && (
          <p>
            Ici viendra la liste de vos patients (lecture/écriture sur vos
            patients uniquement).
          </p>
        )}

        {user?.role === 'chercheur' && (
          <p>
            Ici viendra l'accès aux données pseudonymisées et au
            déclenchement du pipeline NLP.
          </p>
        )}

        {user?.role === 'statisticien' && (
          <p>
            Ici viendra l'accès aux jeux de données statistiques agrégés
            (lecture seule, sans données identifiantes ni pseudonymisées
            individuelles).
          </p>
        )}
      </div>
    </div>
  );
}