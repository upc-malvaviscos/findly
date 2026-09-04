import React, { useEffect, useMemo, useState } from 'react';
import { AuthContext } from './auth';
import type { AuthContextValue } from './auth';

export type AuthSession = {
  idToken: string;
  expiresAt: number;
  username: string;
};

export type AuthGateway = {
  login: (username: string, password: string) => Promise<AuthSession>;
};

const demoGateway: AuthGateway = {
  async login(username, password) {
    if (!username.trim() || password.length < 1)
      throw new Error('INVALID_CREDENTIALS');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    return {
      username: username.trim(),
      expiresAt,
      idToken: `demo-token-${username.trim()}`,
    };
  },
};

export function AuthProvider({
  children,
  gateway = demoGateway,
}: {
  children: React.ReactNode;
  gateway?: AuthGateway;
}) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: session !== null,
      async login(username, password) {
        setSession(await gateway.login(username, password));
      },
      logout() {
        setSession(null);
      },
    }),
    [gateway, session],
  );
  useEffect(() => {
    if (session === null) return;
    const timeout = window.setTimeout(
      () => setSession(null),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
