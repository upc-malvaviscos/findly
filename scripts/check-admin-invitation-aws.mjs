import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

// SDK bodies keep synthetic passwords, challenge sessions and tokens out of
// command arguments and child-process output. This runner accepts CI PR pools only.
export async function checkAdminInvitation({
  cognito,
  sts,
  poolId,
  clientId,
  environment,
}) {
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  assert.match(identity.Arn ?? '', /^arn:aws:sts::[0-9]{12}:assumed-role\//);
  assert.match(environment, /^pr-[1-9][0-9]*$/);
  assert.match(poolId, /^eu-west-1_[A-Za-z0-9]+$/);
  const { UserPool: pool } = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: poolId }),
  );
  assert.equal(pool?.Name, `findly-${environment}-organizers`);
  assert.equal(
    pool?.Arn,
    `arn:aws:cognito-idp:eu-west-1:${identity.Account}:userpool/${poolId}`,
  );
  for (const [key, value] of Object.entries({
    Project: 'findly',
    Environment: environment,
    DataClass: 'synthetic',
    Ephemeral: 'true',
    ManagedBy: 'Terraform',
  }))
    assert.equal(
      pool?.UserPoolTags?.[key],
      value,
      'Pool ownership check failed',
    );
  assert.equal(pool?.AdminCreateUserConfig?.AllowAdminCreateUserOnly, true);
  assert.equal(
    pool?.Policies?.PasswordPolicy?.TemporaryPasswordValidityDays,
    7,
  );
  const { UserPoolClient: client } = await cognito.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: poolId,
      ClientId: clientId,
    }),
  );
  assert.equal(client?.UserPoolId, poolId);
  assert.equal(client?.ClientId, clientId);
  assert.equal(client?.AuthSessionValidity, 3);

  const invited = `invitation-smoke-${randomUUID()}`;
  const signup = `signup-probe-${randomUUID()}`;
  const temporaryPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  const permanentPassword = `${randomBytes(24).toString('base64url')}Bb2!`;
  let stage = 'synthetic invitation';
  let failure;
  const cleanupFailures = [];
  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: invited,
        TemporaryPassword: temporaryPassword,
        MessageAction: 'SUPPRESS',
      }),
    );
    assert.equal(created.User?.UserStatus, 'FORCE_CHANGE_PASSWORD');
    stage = 'temporary password challenge';
    const challenge = await cognito.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: invited, PASSWORD: temporaryPassword },
      }),
    );
    assert.equal(challenge.ChallengeName, 'NEW_PASSWORD_REQUIRED');
    assert(challenge.Session, 'Missing challenge session');
    stage = 'permanent password completion';
    const completed = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId,
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: challenge.Session,
        ChallengeResponses: {
          USERNAME: challenge.ChallengeParameters?.USER_ID_FOR_SRP ?? invited,
          NEW_PASSWORD: permanentPassword,
        },
      }),
    );
    assert(
      completed.AuthenticationResult?.IdToken,
      'Missing authenticated session',
    );
    stage = 'normal login after invitation';
    const authenticated = await cognito.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: invited, PASSWORD: permanentPassword },
      }),
    );
    assert(
      authenticated.AuthenticationResult?.IdToken,
      'Permanent login failed',
    );
    stage = 'self-registration rejection';
    await assert.rejects(
      cognito.send(
        new SignUpCommand({
          ClientId: clientId,
          Username: signup,
          Password: permanentPassword,
        }),
      ),
      (error) => error?.name === 'NotAuthorizedException',
    );
  } catch {
    // SDK/assert errors can include passwords, tokens or identifiers: report stage only.
    failure = new Error(`Admin invitation AWS acceptance failed at: ${stage}`);
  } finally {
    // Delete both unique synthetic identities even if create/signup failed after
    // AWS committed the write but before its response reached the runner.
    for (const username of [invited, signup]) {
      try {
        await cognito.send(
          new AdminDeleteUserCommand({
            UserPoolId: poolId,
            Username: username,
          }),
        );
      } catch (error) {
        if (error?.name !== 'UserNotFoundException')
          cleanupFailures.push(
            new Error('Synthetic Cognito user cleanup failed'),
          );
      }
    }
  }
  if (failure || cleanupFailures.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupFailures],
      'Admin invitation AWS acceptance or cleanup failed',
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.equal(
      process.env.GITHUB_ACTIONS,
      'true',
      'Only the OIDC PR workflow may run this acceptance',
    );
    const outputs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    await checkAdminInvitation({
      cognito: new CognitoIdentityProviderClient({ region: 'eu-west-1' }),
      sts: new STSClient({ region: 'eu-west-1' }),
      poolId: outputs.cognito_user_pool_id?.value,
      clientId: outputs.cognito_client_id?.value,
      environment: outputs.environment?.value,
    });
    console.log(
      'AWS invitation acceptance passed: admin-only registration, suppressed synthetic invitation, NEW_PASSWORD_REQUIRED, permanent login and both fixture cleanups. No email was sent.',
    );
  } catch {
    console.error(
      'AWS invitation acceptance or cleanup failed; inspect the PR-scoped synthetic pool. No secrets are printed.',
    );
    process.exitCode = 1;
  }
}
