import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAdminInvitation } from '../../scripts/check-admin-invitation-aws.mjs';

const poolId = 'eu-west-1_Synthetic';
const clientId = 'synthetic-client';
const configuration = {
  poolId,
  clientId,
  environment: 'pr-123',
  sts: {
    send: async () => ({
      Account: '123456789012',
      Arn: 'arn:aws:sts::123456789012:assumed-role/findly-ci/session',
    }),
  },
};

function fixture(failure?: string, cleanupFailure = false) {
  const commands: { name: string; input: Record<string, unknown> }[] = [];
  const cognito = {
    send: async (command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) => {
      const name = command.constructor.name;
      commands.push({ name, input: command.input });
      if (name === failure)
        throw new Error('sensitive SDK error must not escape');
      if (name === 'DescribeUserPoolCommand')
        return {
          UserPool: {
            Name: 'findly-pr-123-organizers',
            Arn: `arn:aws:cognito-idp:eu-west-1:123456789012:userpool/${poolId}`,
            UserPoolTags: {
              Project: 'findly',
              Environment: 'pr-123',
              DataClass: 'synthetic',
              Ephemeral: 'true',
              ManagedBy: 'Terraform',
            },
            AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
            Policies: { PasswordPolicy: { TemporaryPasswordValidityDays: 7 } },
          },
        };
      if (name === 'DescribeUserPoolClientCommand')
        return {
          UserPoolClient: {
            ClientId: clientId,
            UserPoolId: poolId,
            AuthSessionValidity: 3,
          },
        };
      if (name === 'AdminCreateUserCommand')
        return { User: { UserStatus: 'FORCE_CHANGE_PASSWORD' } };
      if (name === 'InitiateAuthCommand')
        return commands.filter((entry) => entry.name === name).length === 1
          ? {
              ChallengeName: 'NEW_PASSWORD_REQUIRED',
              Session: 'synthetic-session',
            }
          : { AuthenticationResult: { IdToken: 'synthetic-token' } };
      if (name === 'RespondToAuthChallengeCommand')
        return { AuthenticationResult: { IdToken: 'synthetic-token' } };
      if (name === 'SignUpCommand')
        throw Object.assign(new Error('Self-registration disabled'), {
          name: 'NotAuthorizedException',
        });
      if (name === 'AdminDeleteUserCommand' && cleanupFailure)
        throw new Error('cleanup failed');
      return {};
    },
  };
  return { commands, cognito };
}

describe('synthetic invitation AWS runner safeguards (mocked)', () => {
  it('suppresses delivery, completes the challenge and deletes both unique fixtures', async () => {
    const { cognito, commands } = fixture();
    await checkAdminInvitation({ ...configuration, cognito });
    expect(
      commands.find((entry) => entry.name === 'AdminCreateUserCommand')?.input
        .MessageAction,
    ).toBe('SUPPRESS');
    expect(
      commands.filter((entry) => entry.name === 'AdminDeleteUserCommand'),
    ).toHaveLength(2);
    expect(
      commands.find((entry) => entry.name === 'RespondToAuthChallengeCommand')
        ?.input.Session,
    ).toBe('synthetic-session');
  });

  it.each(['AdminCreateUserCommand', 'RespondToAuthChallengeCommand'])(
    'cleans both identities after %s fails and redacts SDK errors',
    async (failure) => {
      const { cognito, commands } = fixture(failure);
      await expect(
        checkAdminInvitation({ ...configuration, cognito }),
      ).rejects.toThrow('Admin invitation AWS acceptance or cleanup failed');
      expect(
        commands.filter((entry) => entry.name === 'AdminDeleteUserCommand'),
      ).toHaveLength(2);
    },
  );

  it('fails after trying all deletions when cleanup fails', async () => {
    const { cognito, commands } = fixture(undefined, true);
    await expect(
      checkAdminInvitation({ ...configuration, cognito }),
    ).rejects.toThrow('cleanup failed');
    expect(
      commands.filter((entry) => entry.name === 'AdminDeleteUserCommand'),
    ).toHaveLength(2);
  });

  it('rejects production and root before mutations', async () => {
    const { cognito, commands } = fixture();
    await expect(
      checkAdminInvitation({
        ...configuration,
        cognito,
        environment: 'production',
      }),
    ).rejects.toThrow();
    await expect(
      checkAdminInvitation({
        ...configuration,
        cognito,
        sts: { send: async () => ({ Arn: 'arn:aws:iam::123456789012:root' }) },
      }),
    ).rejects.toThrow();
    expect(commands).toHaveLength(0);
  });
});

describe('Terraform invitation configuration contract', () => {
  const source = readFileSync('infra/modules/cognito/main.tf', 'utf8');
  it('disables self-registration and uses the standard Cognito invitation', () => {
    expect(source).toContain('allow_admin_create_user_only = true');
    expect(source).not.toContain('invite_message_template');
    expect(source).not.toContain('email_configuration');
    expect(source).toMatch(/temporary_password_validity_days\s*= 7/);
    expect(source).toMatch(/auth_session_validity\s*= 3/);
    expect(source).not.toContain('sms_message');
  });
});
