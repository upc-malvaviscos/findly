import type { AuthGateway, AuthSession } from './context/AuthProvider';

type CognitoConfig = { userPoolId: string; clientId: string; region: string };

type CognitoResponse = {
  AuthenticationResult?: { IdToken?: string; ExpiresIn?: number };
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: {
    USER_ID_FOR_SRP?: string;
    requiredAttributes?: string;
  };
};

function authenticatedSession(
  payload: CognitoResponse,
  username: string,
): AuthSession {
  const token = payload.AuthenticationResult?.IdToken;
  const seconds = payload.AuthenticationResult?.ExpiresIn;
  if (
    payload.ChallengeName ||
    typeof token !== 'string' ||
    !token ||
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  )
    throw new Error('INVALID_COGNITO_RESPONSE');
  return { username, idToken: token, expiresAt: Date.now() + seconds * 1000 };
}

export function cognitoConfigFromEnvironment(): CognitoConfig | null {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim();
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim();
  const region = import.meta.env.VITE_COGNITO_REGION?.trim();
  if (!userPoolId || !clientId || !region) return null;
  return { userPoolId, clientId, region };
}

export function createCognitoGateway(
  config: CognitoConfig | null,
): AuthGateway {
  return {
    async login(username: string, password: string) {
      if (!config) throw new Error('COGNITO_NOT_CONFIGURED');
      const response = await fetch(
        `https://cognito-idp.${config.region}.amazonaws.com/`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
          },
          body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: config.clientId,
            AuthParameters: { USERNAME: username, PASSWORD: password },
          }),
        },
      );
      if (!response.ok) throw new Error('INVALID_CREDENTIALS');
      const payload = (await response.json()) as CognitoResponse;
      if (payload.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        const required: unknown = JSON.parse(
          payload.ChallengeParameters?.requiredAttributes ?? '[]',
        );
        if (
          typeof payload.Session !== 'string' ||
          !payload.Session ||
          !Array.isArray(required) ||
          required.length
        )
          throw new Error('INVALID_COGNITO_RESPONSE');
        return {
          kind: 'new-password-required' as const,
          username:
            payload.ChallengeParameters?.USER_ID_FOR_SRP || username.trim(),
          session: payload.Session,
          expiresAt: Date.now() + 3 * 60 * 1000,
        };
      }
      return authenticatedSession(payload, username.trim());
    },
    async completeNewPassword(challenge, password) {
      if (!config) throw new Error('COGNITO_NOT_CONFIGURED');
      if (Date.now() >= challenge.expiresAt)
        throw new Error('AUTH_CHALLENGE_EXPIRED');
      const response = await fetch(
        `https://cognito-idp.${config.region}.amazonaws.com/`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target':
              'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
          },
          body: JSON.stringify({
            ClientId: config.clientId,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: challenge.session,
            ChallengeResponses: {
              USERNAME: challenge.username,
              NEW_PASSWORD: password,
            },
          }),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { __type?: string };
        if (error.__type?.split('#').at(-1) === 'NotAuthorizedException')
          throw new Error('AUTH_CHALLENGE_EXPIRED');
        throw new Error('NEW_PASSWORD_REJECTED');
      }
      return authenticatedSession(
        (await response.json()) as CognitoResponse,
        challenge.username,
      );
    },
  };
}
