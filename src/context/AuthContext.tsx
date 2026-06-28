import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '@/lib/api';
import type { UserRole } from '@/lib/roles';

// Типы и утилиты ролей — импортируй напрямую из @/lib/roles
export type { UserRole };

export interface Balance {
  currency: string;
  available: number;
  locked: number;
}

export interface User {
  id: number;
  email: string;
  username: string;
  is_admin: boolean;
  role: UserRole;
  kyc_status: string;
  kyc_level: number;
  created_at: string;
  balances: Balance[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const token = localStorage.getItem('nexus_token');
    if (!token) { setLoading(false); return; }
    const { ok, data } = await api.auth.me();
    if (ok) setUser(data as User);
    else { localStorage.removeItem('nexus_token'); setUser(null); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const login = (token: string, userData: User) => {
    localStorage.setItem('nexus_token', token);
    setUser(userData);
  };

  const logout = async () => {
    await api.auth.logout();
    localStorage.removeItem('nexus_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
