import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminResetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { validateProductionPool } from './admin-invitations.mjs';

export const recoveryActors = [
  'anyulled',
  'orLuzuriaga',
  'raati5674',
  'surinyach',
];

function validEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

export function recoveryTarget(env) {
  if (
    env.FINDLY_RECOVERY_ENABLED !== 'true' ||
    env.GITHUB_REPOSITORY !== 'upc-malvaviscos/findly' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    !recoveryActors.includes(env.GITHUB_ACTOR) ||
    env.GITHUB_TRIGGERING_ACTOR !== env.GITHUB_ACTOR ||
    !/^\d{12}$/.test(env.FINDLY_AWS_ACCOUNT_ID ?? '') ||
    !/^eu-west-1_[A-Za-z0-9]+$/.test(env.FINDLY_COGNITO_USER_POOL_ID ?? '') ||
    env.FINDLY_RECOVERY_ROLE_ARN !==
      `arn:aws:iam::${env.FINDLY_AWS_ACCOUNT_ID}:role/findly-organizer-recovery`
  )
    throw new Error('Recovery execution is not authorized.');
  let mapping;
  try {
    mapping = JSON.parse(env.FINDLY_ORGANIZER_ACCOUNTS ?? '');
  } catch {
    throw new Error('Configure the private organizer account mapping.');
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Error('Invalid organizer mapping.');
  const email = Object.hasOwn(mapping, env.GITHUB_ACTOR)
    ? mapping[env.GITHUB_ACTOR]
    : null;
  if (!validEmail(email))
    throw new Error(
      'No valid registered email is configured for this operator.',
    );
  if (
    Object.values(mapping).filter(
      (value) =>
        typeof value === 'string' &&
        value.toLowerCase() === email.toLowerCase(),
    ).length !== 1
  )
    throw new Error('Ambiguous organizer mapping.');
  return {
    email,
    account: env.FINDLY_AWS_ACCOUNT_ID,
    poolId: env.FINDLY_COGNITO_USER_POOL_ID,
  };
}

export async function recoverOrganizer({
  sts,
  cognito,
  credentials,
  email: registeredEmail,
  account,
  poolId,
}) {
  if (!validEmail(registeredEmail)) throw new Error('Invalid recovery target.');
  const pool = await validateProductionPool({
    sts,
    cognito,
    credentials,
    account,
    poolId,
    roleName: 'findly-organizer-recovery',
  });
  let username;
  let token;
  do {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: poolId,
        Filter: `email = ${JSON.stringify(registeredEmail)}`,
        Limit: 2,
        ...(token && { PaginationToken: token }),
      }),
    );
    for (const candidate of result.Users ?? []) {
      if (username || !candidate.Username)
        throw new Error(
          'The registered email does not identify one unique account.',
        );
      username = candidate.Username;
    }
    token = result.PaginationToken;
  } while (token);
  if (!username)
    throw new Error('No existing account matches the registered email.');
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: poolId, Username: username }),
  );
  const email = user.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  if (!user.Enabled || email !== registeredEmail)
    throw new Error('The existing account cannot receive a recovery email.');
  if (user.UserStatus === 'FORCE_CHANGE_PASSWORD') {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: username,
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    return 'invitation';
  }
  if (!['CONFIRMED', 'RESET_REQUIRED'].includes(user.UserStatus))
    throw new Error('The account status does not support recovery.');
  if (
    !user.UserAttributes?.some(
      (a) => a.Name === 'email_verified' && a.Value === 'true',
    ) ||
    !pool.AccountRecoverySetting?.RecoveryMechanisms?.some(
      (m) => m.Name === 'verified_email',
    ) ||
    pool.AccountRecoverySetting.RecoveryMechanisms.some(
      (m) =>
        m.Name === 'verified_phone_number' &&
        m.Priority <=
          pool.AccountRecoverySetting.RecoveryMechanisms.find(
            (r) => r.Name === 'verified_email',
          ).Priority,
    ) ||
    user.UserMFASettingList?.includes('EMAIL_OTP')
  )
    throw new Error(
      'Verified email recovery is not available for this account.',
    );
  await cognito.send(
    new AdminResetUserPasswordCommand({
      UserPoolId: poolId,
      Username: username,
    }),
  );
  return 'reset-code';
}

export function recoveryRoleDocuments({ account, poolId }) {
  if (
    !/^\d{12}$/.test(account ?? '') ||
    !/^eu-west-1_[A-Za-z0-9]+$/.test(poolId ?? '')
  )
    throw new Error('Invalid production account or pool.');
  return {
    trust: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub':
                'repo:upc-malvaviscos/findly:environment:organizer-recovery',
            },
          },
        },
      ],
    },
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'cognito-idp:DescribeUserPool',
            'cognito-idp:AdminGetUser',
            'cognito-idp:ListUsers',
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminResetUserPassword',
          ],
          Resource: `arn:aws:cognito-idp:eu-west-1:${account}:userpool/${poolId}`,
        },
      ],
    },
  };
}
