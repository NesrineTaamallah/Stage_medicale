import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import SetupTotp from './pages/SetupTotp';
import VerifyTotp from './pages/VerifyTotp';
import AdminDashboard from './pages/AdminDashboard';
import UserDashboard from './pages/UserDashboard';
import './App.css';

function PrivateRoute({ children, role }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null; 
  if (!user) return <Navigate to="/login" />;
  
  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!allowedRoles.includes(user?.role)) return <Navigate to="/login" />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/verify-totp" element={<VerifyTotp />} />
        <Route path="/setup-totp" element={<SetupTotp />} />
        <Route path="/admin" element={<PrivateRoute role="admin"><AdminDashboard /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute role={['clinicien', 'chercheur', 'statisticien']}><UserDashboard /></PrivateRoute>} />
      </Routes>
    </AuthProvider>
  );
}