import { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [tempToken, setTempToken] = useState(null);   
  const [totpToken, setTotpToken] = useState(null);    
  const [pendingRole, setPendingRole] = useState(null); 
  const [user, setUser] = useState(null);              
  const [needsTotpSetup, setNeedsTotpSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  
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

  

  function completeAuth(userData) {
    setUser(userData);
  }

  async function logout() {
    try {
      await client.post('/logout');
    } catch {
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