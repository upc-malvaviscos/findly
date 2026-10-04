import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEmailAcceptanceManifest } from './lib/email-acceptance-manifest.mjs';
import { createAcceptanceAws } from './lib/email-acceptance-aws.mjs';
import { authorizeProduction } from './lib/production-controls.mjs';
import {
  requireAcceptanceTimeBudget,
  hasSyntheticEvidence,
  recipientEvidence,
} from './lib/email-acceptance-evidence.mjs';
import { runEmailAcceptance } from './test-gallery-email-aws.mjs';

const env = process.env;
const startedAt = new Date().toISOString();
const runId = env.GITHUB_RUN_ID;
let organizer;
let organizerCreated = false;
let outputs;
let temporary;
let failure;
let summary;

function command(executable, args, childEnv, input) {
  const result = spawnSync(executable, args, {
    env: childEnv,
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0) {
    const category =
      executable === 'aws'
        ? result.stderr.match(/\(([A-Za-z0-9]+)\) when calling/)?.[1]
        : undefined;
    const error = new Error(category ?? 'Acceptance subprocess failed');
    error.code = category ?? 'SUBPROCESS_FAILED';
    throw error;
  }
  return result.stdout;
}

function credentialEnv(credentials) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !key.startsWith('AWS_') &&
        ![
          'FINDLY_EMAIL_ACCEPTANCE_MANIFEST',
          'FINDLY_EMAIL_ACCEPTANCE_RECIPIENTS',
          'GITHUB_TOKEN',
          'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
          'ACTIONS_ID_TOKEN_REQUEST_URL',
        ].includes(key),
    ),
  );
  return {
    ...clean,
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken,
    AWS_REGION: 'eu-west-1',
    AWS_DEFAULT_REGION: 'eu-west-1',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
}

function awsFor(credentials) {
  return createAcceptanceAws({
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
  });
}

async function assume(role) {
  authorizeProduction(env);
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(url.protocol, 'https:');
  assert(
    url.hostname.endsWith('.actions.githubusercontent.com'),
    'Invalid OIDC endpoint',
  );
  url.searchParams.set('audience', 'sts.amazonaws.com');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, 'OIDC request failed');
  const token = (await response.json()).value;
  assert.equal(typeof token, 'string', 'OIDC token unavailable');
  const result = await createAcceptanceAws()(
    'sts',
    'assume-role-with-web-identity',
    {
      RoleArn: role,
      RoleSessionName: `findly-email-${runId}`,
      WebIdentityToken: token,
      DurationSeconds: 3600,
    },
  );
  assert.equal(
    result.AssumedRoleUser.Arn.split(':')[4],
    env.FINDLY_AWS_ACCOUNT_ID,
    'Unexpected STS account',
  );
  return result.Credentials;
}

async function comments() {
  const collected = [];
  for (let page = 1; page <= 50; page++) {
    const response = await fetch(
      `https://api.github.com/repos/upc-malvaviscos/findly/issues/98/comments?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    assert(response.ok, 'Unable to read public acceptance evidence');
    const batch = await response.json();
    collected.push(...batch);
    if (batch.length < 100) return collected;
  }
  throw new Error('Evidence pagination limit exceeded');
}

async function confirmRecipientEvidence() {
  const deadline = Date.now() + 30 * 60 * 1000;
  console.log(
    `Awaiting authorized receipt and opening evidence for providers A and B, run ${runId}.`,
  );
  while (Date.now() < deadline) {
    const proof = recipientEvidence(await comments(), runId, startedAt);
    if (proof.A && proof.B)
      return [proof.A, proof.B].map((item) => ({ ...item, received: true }));
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  throw new Error('Real receipt and opening evidence pending');
}

async function readOutputs(credentials) {
  temporary = await mkdtemp(join(tmpdir(), 'findly-email-readonly-'));
  await cp('infra', join(temporary, 'infra'), {
    recursive: true,
    filter: (source) =>
      !source.split('/').includes('.terraform') &&
      !source.endsWith('.tfstate') &&
      !source.endsWith('.tfstate.backup'),
  });
  const root = join(temporary, 'infra/environments/production');
  const childEnv = credentialEnv(credentials);
  command(
    'terraform',
    [
      `-chdir=${root}`,
      'init',
      '-input=false',
      '-lockfile=readonly',
      `-backend-config=bucket=${env.STATE_BUCKET}`,
      '-backend-config=key=findly/production/terraform.tfstate',
      '-backend-config=region=eu-west-1',
      '-backend-config=encrypt=true',
      '-backend-config=use_lockfile=true',
      '-backend-config=workspace_key_prefix=findly/production/workspaces',
    ],
    childEnv,
  );
  return JSON.parse(
    command('terraform', [`-chdir=${root}`, 'output', '-json'], childEnv),
  );
}

async function verifyOutputs(aws, values, credentials) {
  const value = (key) => values[key]?.value;
  assert.equal(value('table_name'), 'findly-production');
  assert.equal(value('uploads_bucket_name'), env.TF_VAR_uploads_bucket_name);
  assert.equal(value('web_bucket_name'), env.TF_VAR_web_bucket_name);
  assert.equal(value('frontend_origin'), 'https://www.findly.barcelona');
  assert.equal(value('cognito_region'), 'eu-west-1');
  const api = JSON.parse(
    command(
      'aws',
      [
        'apigatewayv2',
        'get-api',
        '--api-id',
        value('api_id'),
        '--region',
        'eu-west-1',
        '--output',
        'json',
        '--no-cli-pager',
      ],
      credentialEnv(credentials),
    ),
  );
  assert.equal(api.Tags.Project, 'findly');
  assert.equal(api.Tags.Environment, 'production');
  assert.equal(api.ApiEndpoint, value('api_endpoint'));
  assert.equal(api.Name, 'findly-production-api');
  const poolId = value('cognito_user_pool_id');
  assert.match(poolId, /^eu-west-1_[A-Za-z0-9]+$/);
  const pool = (
    await aws('cognito-idp', 'describe-user-pool', {
      UserPoolId: poolId,
    })
  ).UserPool;
  assert.equal(
    pool.Arn,
    `arn:aws:cognito-idp:eu-west-1:${env.FINDLY_AWS_ACCOUNT_ID}:userpool/${poolId}`,
  );
  assert.equal(pool.UserPoolTags.Project, 'findly');
  assert.equal(pool.UserPoolTags.Environment, 'production');
  const client = (
    await aws('cognito-idp', 'describe-user-pool-client', {
      UserPoolId: poolId,
      ClientId: value('cognito_client_id'),
    })
  ).UserPoolClient;
  assert(client.ExplicitAuthFlows.includes('ALLOW_USER_PASSWORD_AUTH'));
}

try {
  authorizeProduction(env);
  assert.equal(
    env.FINDLY_AWS_ACCOUNT_ID,
    '567158658992',
    'Unapproved acceptance account',
  );
  assert.equal(env.CONFIRM_NO_PRODUCTION_TRAFFIC, 'true');
  assert(['synthetic', 'recipients'].includes(env.ACCEPTANCE_PHASE));
  assert.match(runId ?? '', /^\d+$/);
  const manifest = validateEmailAcceptanceManifest(
    JSON.parse(env.FINDLY_EMAIL_ACCEPTANCE_MANIFEST ?? ''),
  );
  requireAcceptanceTimeBudget(manifest);
  const recipients =
    env.ACCEPTANCE_PHASE === 'recipients'
      ? JSON.parse(env.FINDLY_EMAIL_ACCEPTANCE_RECIPIENTS ?? '')
      : [];
  if (env.ACCEPTANCE_PHASE === 'recipients') {
    assert.equal(recipients.length, 2);
    assert.equal(
      new Set(recipients).size,
      2,
      'Distinct authorized recipients required',
    );
    assert(
      recipients.every(
        (address) =>
          typeof address === 'string' && /^[^\s@]+@[^\s@]+$/.test(address),
      ),
    );
    const syntheticRun = env.FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC_RUN_ID;
    assert.match(syntheticRun ?? '', /^\d+$/);
    assert(
      hasSyntheticEvidence(
        await comments(),
        syntheticRun,
        env.FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC_STARTED_AT,
      ),
      'Missing trusted completed synthetic AWS evidence',
    );
  }
  const deploy = await assume(env.ROLE_ARN);
  command(
    'node',
    ['scripts/check-production-readiness.mjs'],
    credentialEnv(deploy),
  );
  outputs = await readOutputs(deploy);
  const deployAws = awsFor(deploy);
  await verifyOutputs(deployAws, outputs, deploy);
  organizer = `ses-acceptance-${runId}-${randomUUID()}`;
  const password = `${randomBytes(32).toString('base64url')}Aa1!`;
  organizerCreated = true;
  await deployAws('cognito-idp', 'admin-create-user', {
    UserPoolId: outputs.cognito_user_pool_id.value,
    Username: organizer,
    MessageAction: 'SUPPRESS',
  });
  await deployAws('cognito-idp', 'admin-set-user-password', {
    UserPoolId: outputs.cognito_user_pool_id.value,
    Username: organizer,
    Password: password,
    Permanent: true,
  });
  const jwt = (
    await deployAws('cognito-idp', 'initiate-auth', {
      ClientId: outputs.cognito_client_id.value,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: organizer, PASSWORD: password },
    })
  ).AuthenticationResult.IdToken;
  assert.equal(typeof jwt, 'string');
  const operator = await assume(
    `arn:aws:iam::${env.FINDLY_AWS_ACCOUNT_ID}:role/findly-production-email-acceptance`,
  );
  summary = await runEmailAcceptance({
    manifest,
    outputs,
    jwt,
    recipients,
    phase: env.ACCEPTANCE_PHASE,
    aws: awsFor(operator),
    credentials: {
      accessKeyId: operator.AccessKeyId,
      secretAccessKey: operator.SecretAccessKey,
      sessionToken: operator.SessionToken,
    },
    confirmRecipientEvidence,
  });
  assert.equal(summary.cleanup, 'verified', 'Fixture cleanup not verified');
} catch {
  failure = true;
  console.error(
    'AWS email acceptance failed or remains pending; sensitive diagnostics are withheld.',
  );
} finally {
  if (organizerCreated && outputs) {
    try {
      const deploy = await assume(env.ROLE_ARN);
      await awsFor(deploy)('cognito-idp', 'admin-delete-user', {
        UserPoolId: outputs.cognito_user_pool_id.value,
        Username: organizer,
      });
    } catch (error) {
      if (error.code !== 'UserNotFoundException') {
        failure = true;
        console.error('Temporary organizer cleanup remains incomplete.');
      }
    }
  }
  if (temporary) {
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch {
      failure = true;
      console.error('Temporary read-only workspace cleanup incomplete.');
    }
  }
}

const counts = (summary?.results ?? [])
  .filter((item) => Number.isSafeInteger(item.count) && item.count >= 0)
  .map((item, index) => `Stage ${index + 1}: count ${item.count}`);
const report = [
  `Production email acceptance ${env.ACCEPTANCE_PHASE === 'recipients' ? 'recipients' : 'synthetic'}: ${failure ? 'failed or pending' : 'passed'}.`,
  ...counts,
  'Original crash and concurrent erasure are not demonstrated by injected or preconsumption fixtures.',
  `Cleanup: ${failure ? 'consult pending run' : 'verified'}.`,
].join('\n');
console.log(report);
if (env.GITHUB_STEP_SUMMARY)
  await appendFile(env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (failure) process.exitCode = 1;
