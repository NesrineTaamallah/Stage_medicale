import { useAuth } from '../context/AuthContext';

export default function UserDashboard() {
  const { user, logout } = useAuth();

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
      </div>
    </div>
  );
}