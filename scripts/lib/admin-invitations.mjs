import {
  AdminCreateUserCommand,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';

export const invitationRegion = 'eu-west-1';

export function validateInvitationInput({ account, poolId, username, email }) {
  if (!/^\d{12}$/.test(account ?? ''))
    throw new Error('Configure the expected AWS account before continuing.');
  if (!/^eu-west-1_[A-Za-z0-9]+$/.test(poolId ?? ''))
    throw new Error('Configure a user pool in eu-west-1 before continuing.');
  if (!/^[A-Za-z0-9._@+-]{1,128}$/.test(username ?? ''))
    throw new Error('Enter a valid username without spaces.');
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    email.startsWith('.') ||
    email.split('@')[0].endsWith('.') ||
    email.split('@')[0].includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      email,
    )
  )
    throw new Error('Enter a valid email address.');
}

export async function inviteAdministrator({
  sts,
  cognito,
  credentials,
  account,
  poolId,
  username,
  email,
  send = false,
  now = Date.now(),
}) {
  validateInvitationInput({ account, poolId, username, email });
  if (
    !credentials.sessionToken ||
    !(credentials.expiration instanceof Date) ||
    !Number.isFinite(credentials.expiration.getTime()) ||
    credentials.expiration.getTime() <= now
  )
    throw new Error(
      'Use a current temporary AWS session with a known expiration.',
    );

  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (
    identity.Account !== account ||
    !new RegExp(`^arn:aws:(?:sts|iam)::${account}:`).test(identity.Arn ?? '') ||
    identity.Arn?.endsWith(':root')
  )
    throw new Error(
      'The AWS identity is not an authorized non-root account identity.',
    );

  const result = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: poolId }),
  );
  const pool = result.UserPool;
  const expectedTags = {
    Project: 'findly',
    Environment: 'production',
    ManagedBy: 'Terraform',
    CostCenter: 'findly',
  };
  if (
    pool?.Id !== poolId ||
    pool.Name !== 'findly-production-organizers' ||
    pool.Arn !==
      `arn:aws:cognito-idp:${invitationRegion}:${account}:userpool/${poolId}` ||
    Object.entries(expectedTags).some(
      ([key, value]) => pool.UserPoolTags?.[key] !== value,
    ) ||
    !pool.UserPoolTags?.DataClass ||
    pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly !== true ||
    (pool.EmailConfiguration?.EmailSendingAccount ?? 'COGNITO_DEFAULT') !==
      'COGNITO_DEFAULT'
  )
    throw new Error(
      'The user pool does not match the approved production configuration.',
    );

  if (!send) return { sent: false };
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: username,
        UserAttributes: [{ Name: 'email', Value: email }],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
  } catch (error) {
    if (error?.name === 'UsernameExistsException')
      throw new Error('The account already exists; no invitation was resent.');
    throw new Error(
      'Invitation was not confirmed. Check Cognito before retrying; do not resend automatically.',
    );
  }
  return { sent: true };
}
