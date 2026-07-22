import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import SetupTotp from './pages/SetupTotp';
import VerifyTotp from './pages/VerifyTotp';
import AdminDashboard from './pages/AdminDashboard';
import UserDashboard from './pages/UserDashboard';
import './App.css';

function PrivateRoute({ children, role }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null; // évite un flash de redirection pendant la vérification /me
  if (!user) return <Navigate to="/" />;
  if (role && user?.role !== role) return <Navigate to="/" />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/verify-totp" element={<VerifyTotp />} />
        <Route path="/setup-totp" element={<SetupTotp />} />
        <Route path="/admin" element={<PrivateRoute role="admin"><AdminDashboard /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute><UserDashboard /></PrivateRoute>} />
      </Routes>
    </AuthProvider>
  );
}