import type { AuthGateway, AuthSession } from './context/AuthProvider';

type CognitoConfig = { userPoolId: string; clientId: string; region: string };

type CognitoResponse = {
  AuthenticationResult?: { IdToken?: string; ExpiresIn?: number };
};

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
    async login(username: string, password: string): Promise<AuthSession> {
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
      const idToken = payload.AuthenticationResult?.IdToken;
      const expiresIn = payload.AuthenticationResult?.ExpiresIn;
      if (!idToken || !expiresIn) throw new Error('INVALID_COGNITO_RESPONSE');
      return {
        username: username.trim(),
        idToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };
    },
  };
}
