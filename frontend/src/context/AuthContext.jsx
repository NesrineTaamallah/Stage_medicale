import { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [tempToken, setTempToken] = useState(null);   // scope: change_password_only (en mémoire uniquement)
  const [totpToken, setTotpToken] = useState(null);    // scope: totp_pending (en mémoire uniquement)
  const [pendingRole, setPendingRole] = useState(null); // rôle du compte en attente de validation 2FA — pour adapter le message d'aide
  const [user, setUser] = useState(null);              // { sub, email, role }
  const [needsTotpSetup, setNeedsTotpSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Au chargement de l'app : le token final vit dans un cookie httpOnly,
  // donc invisible en JS. On demande au backend qui est connecté via /me.
  useEffect(() => {
    async function checkSession() {
      try {
        const { data } = await client.get('/me');
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }
    checkSession();
  }, []);

  

  // Le backend a déjà posé le cookie httpOnly ; on ne fait que mémoriser l'utilisateur côté React.
  function completeAuth(userData) {
    setUser(userData);
  }

  async function logout() {
    try {
      await client.post('/logout');
    } catch {
      // même en cas d'erreur réseau, on efface l'état local
    }
    setUser(null);
    setTempToken(null);
    setTotpToken(null);
    setPendingRole(null);
  }

  return (
    <AuthContext.Provider value={{
      tempToken, setTempToken,
      totpToken, setTotpToken,
      pendingRole, setPendingRole,
      user, completeAuth,
      needsTotpSetup, setNeedsTotpSetup,
      isLoading,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}