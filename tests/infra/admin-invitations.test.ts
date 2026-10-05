import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { inviteAdministrator } from '../../scripts/lib/admin-invitations.mjs';

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const stsMock = mockClient(STSClient);
const account = '123456789012';
const poolId = 'eu-west-1_synthetic';
const pool = {
  Id: poolId,
  Name: 'findly-production-organizers',
  Arn: `arn:aws:cognito-idp:eu-west-1:${account}:userpool/${poolId}`,
  UserPoolTags: {
    Project: 'findly',
    Environment: 'production',
    ManagedBy: 'Terraform',
    CostCenter: 'findly',
    DataClass: 'biometric',
  },
  AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
  EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' as const },
};
function request() {
  return {
    sts: new STSClient({ region: 'eu-west-1' }),
    cognito: new CognitoIdentityProviderClient({ region: 'eu-west-1' }),
    credentials: {
      sessionToken: 'synthetic-session',
      expiration: new Date('2030-01-01'),
    },
    account,
    poolId,
    username: 'synthetic-organizer',
    email: 'synthetic@example.invalid',
    now: new Date('2026-01-01').getTime(),
  };
}
beforeEach(() => {
  cognitoMock.reset();
  stsMock.reset();
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: account,
    Arn: `arn:aws:sts::${account}:assumed-role/limited-operator/synthetic`,
  });
  cognitoMock.on(DescribeUserPoolCommand).resolves({ UserPool: pool });
  cognitoMock.on(AdminCreateUserCommand).resolves({});
});

describe('production administrator invitation (mocked AWS only)', () => {
  it('validates only by default, without creating or changing a user', async () => {
    await expect(inviteAdministrator(request())).resolves.toEqual({
      sent: false,
    });
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('requests one generated temporary password by email without asserting verification', async () => {
    await expect(
      inviteAdministrator({ ...request(), send: true }),
    ).resolves.toEqual({ sent: true });
    const calls = cognitoMock.commandCalls(AdminCreateUserCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toEqual({
      UserPoolId: poolId,
      Username: 'synthetic-organizer',
      UserAttributes: [{ Name: 'email', Value: 'synthetic@example.invalid' }],
      DesiredDeliveryMediums: ['EMAIL'],
    });
  });
  it.each([
    { account: 'foreign' },
    { poolId: 'us-east-1_synthetic' },
    { username: 'unexpected user' },
    { username: ' exact-user ' },
    { email: 'invalid' },
    { email: 'synthetic@example.invalid\nheader' },
  ])('rejects invalid input before reaching AWS: %j', async (invalid) => {
    await expect(
      inviteAdministrator({ ...request(), ...invalid, send: true }),
    ).rejects.toThrow();
    expect(stsMock.calls()).toHaveLength(0);
    expect(cognitoMock.calls()).toHaveLength(0);
  });
  it.each([
    { sessionToken: '', expiration: new Date('2030-01-01') },
    { sessionToken: 'temporary', expiration: undefined },
    { sessionToken: 'temporary', expiration: new Date('2020-01-01') },
    { sessionToken: 'temporary', expiration: new Date('invalid') },
  ])('refuses static, unknown or expired credentials', async (credentials) => {
    await expect(
      inviteAdministrator({ ...request(), credentials, send: true }),
    ).rejects.toThrow('temporary AWS session');
    expect(stsMock.calls()).toHaveLength(0);
    expect(cognitoMock.calls()).toHaveLength(0);
  });
  it.each([
    { Account: account, Arn: `arn:aws:iam::${account}:root` },
    {
      Account: '999999999999',
      Arn: 'arn:aws:sts::999999999999:assumed-role/operator/session',
    },
    { Account: account, Arn: 'unknown' },
  ])(
    'rejects root and foreign or malformed caller identities',
    async (identity) => {
      stsMock.on(GetCallerIdentityCommand).resolves(identity);
      await expect(
        inviteAdministrator({ ...request(), send: true }),
      ).rejects.toThrow('non-root');
      expect(cognitoMock.calls()).toHaveLength(0);
    },
  );
  it.each([
    { Name: 'findly-pr-123-organizers' },
    {
      Arn: 'arn:aws:cognito-idp:eu-west-1:999999999999:userpool/eu-west-1_synthetic',
    },
    { Id: 'eu-west-1_other' },
    { UserPoolTags: { ...pool.UserPoolTags, Environment: 'sandbox' } },
    { UserPoolTags: { ...pool.UserPoolTags, ManagedBy: 'manual' } },
    { UserPoolTags: { ...pool.UserPoolTags, DataClass: '' } },
    { AdminCreateUserConfig: { AllowAdminCreateUserOnly: false } },
    { EmailConfiguration: { EmailSendingAccount: 'DEVELOPER' as const } },
  ])(
    'fails closed on an unapproved user pool configuration',
    async (override) => {
      cognitoMock
        .on(DescribeUserPoolCommand)
        .resolves({ UserPool: { ...pool, ...override } });
      await expect(
        inviteAdministrator({ ...request(), send: true }),
      ).rejects.toThrow('approved production configuration');
      expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    },
  );
  it('does not resend to an existing username or update its attributes', async () => {
    cognitoMock
      .on(AdminCreateUserCommand)
      .rejects({ name: 'UsernameExistsException' });
    await expect(
      inviteAdministrator({ ...request(), send: true }),
    ).rejects.toThrow('no invitation was resent');
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(1);
  });
  it('does not leak AWS error contact data or retry an uncertain send', async () => {
    cognitoMock
      .on(AdminCreateUserCommand)
      .rejects(new Error('synthetic@example.invalid private data'));
    await expect(
      inviteAdministrator({ ...request(), send: true }),
    ).rejects.toThrow(
      'Invitation was not confirmed. Check Cognito before retrying; do not resend automatically.',
    );
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(1);
  });
});
