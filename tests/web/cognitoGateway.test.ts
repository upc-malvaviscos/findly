import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCognitoGateway } from '../../src/web/cognitoGateway';

afterEach(() => vi.restoreAllMocks());

describe('Cognito gateway', () => {
  it('completes the challenge with its canonical username and no temporary password', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          AuthenticationResult: { IdToken: 'id-token', ExpiresIn: 3600 },
        }),
      ),
    );
    const gateway = createCognitoGateway({
      userPoolId: 'eu-west-1_test',
      clientId: 'client',
      region: 'eu-west-1',
    });
    const challenge = {
      kind: 'new-password-required' as const,
      username: 'canonical-user',
      session: 'synthetic-challenge',
      expiresAt: Date.now() + 60_000,
    };
    await expect(
      gateway.completeNewPassword?.(challenge, 'Permanent1!test'),
    ).resolves.toMatchObject({
      idToken: 'id-token',
      username: 'canonical-user',
    });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      'x-amz-target':
        'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      ClientId: 'client',
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'synthetic-challenge',
      ChallengeResponses: {
        USERNAME: 'canonical-user',
        NEW_PASSWORD: 'Permanent1!test',
      },
    });
  });
  it('does not send a password for an expired challenge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      createCognitoGateway({
        userPoolId: 'eu-west-1_test',
        clientId: 'client',
        region: 'eu-west-1',
      }).completeNewPassword?.(
        {
          kind: 'new-password-required',
          username: 'invited',
          session: 'synthetic',
          expiresAt: Date.now() - 1,
        },
        'Permanent1!test',
      ),
    ).rejects.toThrow('AUTH_CHALLENGE_EXPIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['InvalidPasswordException', 'NEW_PASSWORD_REJECTED'],
    ['NotAuthorizedException', 'AUTH_CHALLENGE_EXPIRED'],
  ])('handles %s without exposing the AWS message', async (type, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __type: type, message: 'private-server-detail' }),
        { status: 400 },
      ),
    );
    await expect(
      createCognitoGateway({
        userPoolId: 'eu-west-1_test',
        clientId: 'client',
        region: 'eu-west-1',
      }).completeNewPassword?.(
        {
          kind: 'new-password-required',
          username: 'invited',
          session: 'synthetic',
          expiresAt: Date.now() + 60_000,
        },
        'Permanent1!test',
      ),
    ).rejects.toThrow(expected);
  });
  it('does not authenticate unsupported challenges or missing sessions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const gateway = createCognitoGateway({
      userPoolId: 'eu-west-1_test',
      clientId: 'client',
      region: 'eu-west-1',
    });
    for (const payload of [
      { ChallengeName: 'SMS_MFA', Session: 'synthetic' },
      { ChallengeName: 'NEW_PASSWORD_REQUIRED' },
      {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'synthetic',
        ChallengeParameters: { requiredAttributes: '["userAttributes.email"]' },
      },
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
      await expect(gateway.login('invited', 'temporary')).rejects.toThrow(
        'INVALID_COGNITO_RESPONSE',
      );
    }
  });
  it('returns an invitation challenge instead of authenticating a temporary password', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: 'synthetic-challenge',
          ChallengeParameters: {
            USER_ID_FOR_SRP: 'canonical-user',
            requiredAttributes: '[]',
          },
        }),
      ),
    );
    await expect(
      createCognitoGateway({
        userPoolId: 'eu-west-1_test',
        clientId: 'client',
        region: 'eu-west-1',
      }).login('organizer', 'temporary'),
    ).resolves.toMatchObject({
      kind: 'new-password-required',
      username: 'canonical-user',
      session: 'synthetic-challenge',
    });
  });
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
    expect(session).toMatchObject({ idToken: 'id-token' });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'client',
      AuthParameters: { USERNAME: 'organizer', PASSWORD: 'password' },
    });
  });
});
