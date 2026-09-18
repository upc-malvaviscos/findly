import React, { useEffect, useMemo, useState } from 'react';
import { AuthContext } from './auth';
import type { AuthContextValue } from './auth';
import {
  cognitoConfigFromEnvironment,
  createCognitoGateway,
} from '../cognitoGateway';
import { executionMode } from '../executionMode';
import { createLocalAuthGateway } from '../localAuthGateway';

export type AuthSession = {
  idToken: string;
  expiresAt: number;
  username: string;
};

export type AuthGateway = {
  login: (username: string, password: string) => Promise<AuthSession>;
};

const configuredGateway =
  executionMode === 'mock' || executionMode === 'floci'
    ? createLocalAuthGateway()
    : createCognitoGateway(cognitoConfigFromEnvironment());

export function AuthProvider({
  children,
  gateway = configuredGateway,
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
