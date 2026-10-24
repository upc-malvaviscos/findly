import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import {
  authorizeRecoveryPublication,
  publicRecoveryOutputs,
  verifyRecoveryDestinations,
} from './lib/recovery-publication.mjs';

authorizeRecoveryPublication(process.env);
if (!process.argv.includes('--check')) {
  const run = (args) => {
    const result = spawnSync('aws', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0)
      throw new Error(
        `AWS read failed: ${args[0]} ${args[1]}. No publication was attempted.`,
      );
    return JSON.parse(result.stdout);
  };
  const aws = (args) =>
    run([...args, '--region', 'eu-west-1', '--output', 'json']);
  // Parse state in memory and retain only validated non-sensitive outputs.
  const state = run([
    's3',
    'cp',
    `s3://${process.env.STATE_BUCKET}/findly/production/terraform.tfstate`,
    '-',
    '--only-show-errors',
    '--region',
    'eu-west-1',
  ]);
  const values = publicRecoveryOutputs(state);
  verifyRecoveryDestinations(values, {
    identity: aws(['sts', 'get-caller-identity']),
    api: aws(['apigatewayv2', 'get-api', '--api-id', values.api_id]),
    pool: aws([
      'cognito-idp',
      'describe-user-pool',
      '--user-pool-id',
      values.cognito_user_pool_id,
    ]).UserPool,
    client: aws([
      'cognito-idp',
      'describe-user-pool-client',
      '--user-pool-id',
      values.cognito_user_pool_id,
      '--client-id',
      values.cognito_client_id,
    ]).UserPoolClient,
    distribution: aws([
      'cloudfront',
      'get-distribution',
      '--id',
      values.web_distribution_id,
    ]).Distribution,
  });
  const variables = {
    VITE_FINDLY_EXECUTION_MODE: 'aws',
    VITE_API_BASE_URL: values.api_endpoint,
    VITE_COGNITO_USER_POOL_ID: values.cognito_user_pool_id,
    VITE_COGNITO_CLIENT_ID: values.cognito_client_id,
    VITE_COGNITO_REGION: values.cognito_region,
    VITE_GALLERY_EMAIL_ENABLED: 'true',
    RECOVERY_WEB_BUCKET: values.web_bucket_name,
    RECOVERY_DISTRIBUTION_ID: values.web_distribution_id,
  };
  if (!process.env.GITHUB_ENV || !process.env.RUNNER_TEMP)
    throw new Error('GitHub runner required');
  appendFileSync(
    process.env.GITHUB_ENV,
    Object.entries(variables)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  writeFileSync(
    `${process.env.RUNNER_TEMP}/recovery-public-outputs.json`,
    `${JSON.stringify(values)}\n`,
  );
  console.log(
    'Public outputs agree with deployed API, Cognito client and private CloudFront origin. No AWS mutations were requested.',
  );
} else {
  console.log(
    'Manual production publication authorized before AWS credentials.',
  );
}
