import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  login: (
    username: string,
    password: string,
  ) => Promise<AuthSession | NewPasswordChallenge>;
  completeNewPassword?: (
    challenge: NewPasswordChallenge,
    password: string,
  ) => Promise<AuthSession>;
};

export type NewPasswordChallenge = {
  kind: 'new-password-required';
  username: string;
  session: string;
  expiresAt: number;
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
  const [challenge, setChallenge] = useState<NewPasswordChallenge | null>(null);
  const [challengeExpired, setChallengeExpired] = useState(false);
  const request = useRef(0);
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: session !== null,
      newPasswordChallenge: challenge,
      challengeExpired,
      async login(username, password) {
        const current = ++request.current;
        setSession(null);
        setChallenge(null);
        setChallengeExpired(false);
        const result = await gateway.login(username, password);
        if (current !== request.current) throw new Error('AUTH_CANCELLED');
        if ('kind' in result) {
          setChallenge(result);
          return 'new-password-required';
        }
        setSession(result);
        return 'authenticated';
      },
      async completeNewPassword(password) {
        if (!challenge || Date.now() >= challenge.expiresAt) {
          setChallenge(null);
          setChallengeExpired(true);
          throw new Error('AUTH_CHALLENGE_EXPIRED');
        }
        if (!gateway.completeNewPassword)
          throw new Error('AUTH_CHALLENGE_UNSUPPORTED');
        const current = ++request.current;
        try {
          const authenticated = await gateway.completeNewPassword(
            challenge,
            password,
          );
          if (current !== request.current) throw new Error('AUTH_CANCELLED');
          setChallenge(null);
          setSession(authenticated);
        } catch (error) {
          if (
            current === request.current &&
            error instanceof Error &&
            error.message === 'AUTH_CHALLENGE_EXPIRED'
          ) {
            setChallenge(null);
            setChallengeExpired(true);
          }
          throw error;
        }
      },
      cancelNewPassword() {
        ++request.current;
        setChallenge(null);
        setChallengeExpired(false);
      },
      logout() {
        ++request.current;
        setSession(null);
        setChallenge(null);
        setChallengeExpired(false);
      },
    }),
    [gateway, session, challenge, challengeExpired],
  );
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  useEffect(() => {
    if (!challenge) return;
    const timeout = window.setTimeout(
      () => {
        ++request.current;
        setChallenge(null);
        setChallengeExpired(true);
      },
      Math.max(0, challenge.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [challenge]);
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
