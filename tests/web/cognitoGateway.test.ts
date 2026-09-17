import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCognitoGateway } from '../../src/web/cognitoGateway';

afterEach(() => vi.restoreAllMocks());

describe('Cognito gateway', () => {
  it('fails safely without public Cognito configuration', async () => {
    await expect(
      createCognitoGateway(null).login('organizer', 'password'),
    ).rejects.toThrow('COGNITO_NOT_CONFIGURED');
  });

  it('uses USER_PASSWORD_AUTH and keeps the ID token in the returned memory session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          AuthenticationResult: { IdToken: 'id-token', ExpiresIn: 3600 },
        }),
        { status: 200 },
      ),
    );
    const session = await createCognitoGateway({
      userPoolId: 'eu-west-1_test',
      clientId: 'client',
      region: 'eu-west-1',
    }).login('organizer', 'password');
    expect(session.idToken).toBe('id-token');
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'client',
      AuthParameters: { USERNAME: 'organizer', PASSWORD: 'password' },
    });
  });
});
