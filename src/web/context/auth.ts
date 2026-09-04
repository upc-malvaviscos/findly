import { createContext, useContext } from 'react';
import type { AuthSession } from './AuthProvider';

export type AuthContextValue = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null)
    throw new Error('useAuth must be used within AuthProvider');
  return context;
}
