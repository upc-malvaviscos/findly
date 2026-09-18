import type { AuthGateway, AuthSession } from './context/AuthProvider';

export const LOCAL_ORGANIZER_USERNAME = 'organizer';
export const LOCAL_ORGANIZER_PASSWORD = 'findly-local-only';

export function createLocalAuthGateway(): AuthGateway {
  return {
    async login(username: string, password: string): Promise<AuthSession> {
      if (
        username !== LOCAL_ORGANIZER_USERNAME ||
        password !== LOCAL_ORGANIZER_PASSWORD
      )
        throw new Error('INVALID_LOCAL_CREDENTIALS');
      return {
        username,
        idToken: 'local-organizer-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    },
  };
}
