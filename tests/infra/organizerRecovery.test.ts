import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminResetUserPasswordCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  recoverOrganizer,
  recoveryTarget,
  recoveryRoleDocuments,
} from '../../scripts/lib/organizer-recovery.mjs';

const account = '123456789012';
const poolId = 'eu-west-1_synthetic';
const cognito = mockClient(CognitoIdentityProviderClient);
const sts = mockClient(STSClient);
const pool = {
  Id: poolId,
  Name: 'findly-production-organizers',
  Arn: `arn:aws:cognito-idp:eu-west-1:${account}:userpool/${poolId}`,
  UserPoolTags: {
    Project: 'findly',
    Environment: 'production',
    ManagedBy: 'Terraform',
    CostCenter: 'findly',
    DataClass: 'operational',
  },
  AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
  AccountRecoverySetting: {
    RecoveryMechanisms: [{ Name: 'verified_email' as const, Priority: 1 }],
  },
};
const attrs = [
  { Name: 'email', Value: 'synthetic@example.invalid' },
  { Name: 'email_verified', Value: 'true' },
];
function options() {
  return {
    sts: new STSClient({ region: 'eu-west-1' }),
    cognito: new CognitoIdentityProviderClient({ region: 'eu-west-1' }),
    credentials: {
      sessionToken: 'synthetic',
      expiration: new Date(Date.now() + 60000),
    },
    account,
    poolId,
    email: 'synthetic@example.invalid',
  };
}
function env() {
  return {
    FINDLY_RECOVERY_ENABLED: 'true',
    GITHUB_REPOSITORY: 'upc-malvaviscos/findly',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR: 'anyulled',
    GITHUB_TRIGGERING_ACTOR: 'anyulled',
    FINDLY_AWS_ACCOUNT_ID: account,
    FINDLY_COGNITO_USER_POOL_ID: poolId,
    FINDLY_RECOVERY_ROLE_ARN: `arn:aws:iam::${account}:role/findly-organizer-recovery`,
    FINDLY_ORGANIZER_ACCOUNTS: JSON.stringify({
      anyulled: 'synthetic@example.invalid',
      surinyach: 'other@example.invalid',
    }),
  };
}
beforeEach(() => {
  sts.reset();
  cognito.reset();
  sts.on(GetCallerIdentityCommand).resolves({
    Account: account,
    Arn: `arn:aws:sts::${account}:assumed-role/findly-organizer-recovery/test`,
  });
  cognito.on(DescribeUserPoolCommand).resolves({ UserPool: pool });
  cognito
    .on(ListUsersCommand)
    .resolves({ Users: [{ Username: 'synthetic-organizer' }] });
  cognito.on(AdminGetUserCommand).resolves({
    Enabled: true,
    UserStatus: 'CONFIRMED',
    UserAttributes: attrs,
  });
  cognito.on(AdminResetUserPasswordCommand).resolves({});
  cognito.on(AdminCreateUserCommand).resolves({});
});
describe('own-account organizer recovery (mocked AWS)', () => {
  it('looks up the canonical username by the privately configured email', async () => {
    await recoverOrganizer(options());
    expect(cognito.commandCalls(ListUsersCommand)[0]?.args[0].input).toEqual({
      UserPoolId: poolId,
      Filter: 'email = "synthetic@example.invalid"',
      Limit: 2,
    });
    expect(cognito.commandCalls(AdminGetUserCommand)[0]?.args[0].input).toEqual(
      {
        UserPoolId: poolId,
        Username: 'synthetic-organizer',
      },
    );
  });
  it.each([
    { users: [] },
    { users: [{ Username: 'first' }, { Username: 'second' }] },
  ])('rejects missing or ambiguous email matches', async ({ users }) => {
    cognito.on(ListUsersCommand).resolves({ Users: users });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('checks subsequent pages before accepting a unique match', async () => {
    cognito
      .on(ListUsersCommand)
      .resolvesOnce({ Users: [], PaginationToken: 'next-page' })
      .resolvesOnce({ Users: [{ Username: 'synthetic-organizer' }] });
    await expect(recoverOrganizer(options())).resolves.toBe('reset-code');
    expect(
      cognito.commandCalls(ListUsersCommand)[1]?.args[0].input.PaginationToken,
    ).toBe('next-page');
  });
  it('does not send if the registered email changed after lookup', async () => {
    cognito.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [
        { Name: 'email', Value: 'other@example.invalid' },
        { Name: 'email_verified', Value: 'true' },
      ],
    });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('resolves only the original actor and never permits a rerun to target someone else', () => {
    expect(recoveryTarget(env())).toMatchObject({
      email: 'synthetic@example.invalid',
    });
    expect(() =>
      recoveryTarget({ ...env(), GITHUB_TRIGGERING_ACTOR: 'surinyach' }),
    ).toThrow();
    expect(() =>
      recoveryTarget({
        ...env(),
        GITHUB_ACTOR: 'intruder',
        GITHUB_TRIGGERING_ACTOR: 'intruder',
      }),
    ).toThrow();
  });
  it.each([
    { FINDLY_RECOVERY_ENABLED: '' },
    { GITHUB_REF: 'refs/heads/feature/test' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REPOSITORY: 'foreign/findly' },
    { FINDLY_ORGANIZER_ACCOUNTS: '{}' },
    { FINDLY_ORGANIZER_ACCOUNTS: '{invalid' },
    {
      FINDLY_ORGANIZER_ACCOUNTS:
        '{"anyulled":"shared@example.invalid","surinyach":"shared@example.invalid"}',
    },
    {
      FINDLY_RECOVERY_ROLE_ARN: `arn:aws:iam::${account}:role/findly-production-deploy`,
    },
  ])('rejects unsafe execution before credentials: %j', (override) => {
    expect(() => recoveryTarget({ ...env(), ...override })).toThrow();
  });
  it('resends the invitation to the existing unverified email without setting attributes or a password', async () => {
    cognito.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'FORCE_CHANGE_PASSWORD',
      UserAttributes: [attrs[0]!],
    });
    expect(await recoverOrganizer(options())).toBe('invitation');
    expect(
      cognito.commandCalls(AdminCreateUserCommand)[0]?.args[0].input,
    ).toEqual({
      UserPoolId: poolId,
      Username: 'synthetic-organizer',
      MessageAction: 'RESEND',
      DesiredDeliveryMediums: ['EMAIL'],
    });
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(0);
  });
  it.each(['CONFIRMED', 'RESET_REQUIRED'] as const)(
    'sends a reset code for %s without resending an invitation',
    async (status) => {
      cognito
        .on(AdminGetUserCommand)
        .resolves({ Enabled: true, UserStatus: status, UserAttributes: attrs });
      expect(await recoverOrganizer(options())).toBe('reset-code');
      expect(
        cognito.commandCalls(AdminResetUserPasswordCommand)[0]?.args[0].input,
      ).toEqual({ UserPoolId: poolId, Username: 'synthetic-organizer' });
      expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    },
  );
  it.each([
    { Enabled: false },
    { UserStatus: 'UNCONFIRMED' as const },
    { UserStatus: 'EXTERNAL_PROVIDER' as const },
    { UserAttributes: [] },
    { UserAttributes: [attrs[0]!] },
    { UserMFASettingList: ['EMAIL_OTP'] },
  ])('never mutates unsupported users: %j', async (override) => {
    cognito.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: attrs,
      ...override,
    });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('does not create missing accounts', async () => {
    cognito.on(AdminGetUserCommand).rejects({ name: 'UserNotFoundException' });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('rejects foreign pools before reading a user', async () => {
    cognito
      .on(DescribeUserPoolCommand)
      .resolves({ UserPool: { ...pool, Name: 'findly-demo-organizers' } });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminGetUserCommand)).toHaveLength(0);
  });
  it('requires verified email recovery to be configured', async () => {
    cognito.on(DescribeUserPoolCommand).resolves({
      UserPool: {
        ...pool,
        AccountRecoverySetting: {
          RecoveryMechanisms: [{ Name: 'admin_only', Priority: 1 }],
        },
      },
    });
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(0);
  });
  it('does not request a second send after an uncertain result', async () => {
    cognito
      .on(AdminResetUserPasswordCommand)
      .rejects(new Error('private contact'));
    await expect(recoverOrganizer(options())).rejects.toThrow();
    expect(cognito.commandCalls(AdminResetUserPasswordCommand)).toHaveLength(1);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
  it('generates an environment-scoped OIDC trust and pool-scoped permissions without deploy or SES access', () => {
    const docs = recoveryRoleDocuments({ account, poolId });
    expect(docs.policy).toMatchObject({
      Statement: [
        {
          Resource: `arn:aws:cognito-idp:eu-west-1:${account}:userpool/${poolId}`,
        },
      ],
    });
    expect(JSON.stringify(docs)).toContain(
      'repo:upc-malvaviscos/findly:environment:organizer-recovery',
    );
    expect(JSON.stringify(docs.policy)).not.toMatch(
      /\*|ses:|iam:|DeleteUser|UpdateUser/,
    );
  });
});
