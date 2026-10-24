import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { authorizeProduction } from './production-controls.mjs';

// One recovery release, not an alternative deployment of arbitrary revisions.
export const recoveryRelease = {
  baseCommit: '11c522923e937bfe5e97130de06217513052afde',
  recoveryCommit: '7218c3b268d02e11817a1a60ce86b049abdbf2ba',
  authenticationFiles: [
    'src/web/cognitoGateway.ts',
    'src/web/context/AuthProvider.tsx',
    'src/web/context/auth.ts',
    'src/web/components/admin/AdminLogin.tsx',
    'src/web/components/admin/PasswordRecoveryForm.tsx',
  ],
  dependencyFiles: ['package.json', 'package-lock.json'],
};

export const recoveryOrigin = 'https://www.findly.barcelona';
// Read from production on 2026-10-25 and tied to deployment 38808198446.
// A future replay must not replace a newer, unrelated application.
const predecessorAssetHash =
  '12a1c915617822635fef6d76a218ebe2d1818b6a6d3b588d1c9958eae6ff724b';

export function verifyRecoveryPredecessor(currentAsset, nextAsset) {
  const hash = (asset) => createHash('sha256').update(asset).digest('hex');
  assert(
    [predecessorAssetHash, hash(nextAsset)].includes(hash(currentAsset)),
    'Production web has changed; review a new release instead of replacing it',
  );
}

const account = '567158658992';
const region = 'eu-west-1';

export function authorizeRecoveryPublication(env) {
  assert.equal(env.FINDLY_AWS_ACCOUNT_ID, account, 'Wrong production account');
  assert.equal(env.AWS_REGION, region, 'Wrong production region');
  assert.notEqual(env.SHARED_CONFIGURATION, 'true', 'Deployment role required');
  authorizeProduction({
    ...env,
    TF_VAR_web_bucket_name: `findly-production-web-${account}-${region}`,
    TF_VAR_uploads_bucket_name: `findly-production-uploads-${account}-${region}`,
  });
}

export function publicRecoveryOutputs(state) {
  const output = (name) => {
    const entry = state.outputs?.[name];
    assert(
      entry && [undefined, false].includes(entry.sensitive),
      `Public output required: ${name}`,
    );
    assert.equal(
      typeof entry.value,
      'string',
      `String output required: ${name}`,
    );
    return entry.value;
  };
  const values = Object.fromEntries(
    [
      'api_id',
      'api_endpoint',
      'cognito_user_pool_id',
      'cognito_client_id',
      'cognito_region',
      'web_bucket_name',
      'web_distribution_id',
      'frontend_origin',
    ].map((name) => [name, output(name)]),
  );
  assert.match(values.api_id, /^[a-z0-9]+$/);
  assert(
    [
      `https://${values.api_id}.execute-api.${region}.amazonaws.com`,
      `https://${values.api_id}.execute-api.${region}.amazonaws.com/`,
    ].includes(values.api_endpoint),
    'Unexpected deployed API endpoint',
  );
  assert.equal(values.cognito_user_pool_id, 'eu-west-1_73pdc5T9W');
  assert.match(values.cognito_client_id, /^[a-z0-9]{1,128}$/);
  assert.equal(values.cognito_region, region);
  assert.equal(
    values.web_bucket_name,
    `findly-production-web-${account}-${region}`,
  );
  assert.match(values.web_distribution_id, /^[A-Z0-9]{1,32}$/);
  assert.equal(values.frontend_origin, recoveryOrigin);
  return values;
}

export function verifyRecoveryDestinations(
  values,
  { identity, api, pool, client, distribution },
) {
  assert.equal(identity.Account, account);
  assert(
    identity.Arn?.startsWith(
      `arn:aws:sts::${account}:assumed-role/findly-production-deploy/`,
    ),
    'Existing deployment role session required',
  );
  assert.equal(api.ApiId, values.api_id);
  assert.equal(
    api.ApiEndpoint?.replace(/\/$/, ''),
    values.api_endpoint.replace(/\/$/, ''),
  );
  assert.equal(api.ProtocolType, 'HTTP');
  assert.equal(pool.Id, values.cognito_user_pool_id);
  assert.equal(pool.Name, 'findly-production-organizers');
  assert.equal(
    pool.Arn,
    `arn:aws:cognito-idp:${region}:${account}:userpool/${pool.Id}`,
  );
  assert.equal(client.UserPoolId, pool.Id);
  assert.equal(client.ClientId, values.cognito_client_id);
  assert(!client.ClientSecret, 'SPA client must not have a secret');
  assert(client.ExplicitAuthFlows?.includes('ALLOW_USER_PASSWORD_AUTH'));
  assert.equal(distribution.Id, values.web_distribution_id);
  assert.equal(
    distribution.ARN,
    `arn:aws:cloudfront::${account}:distribution/${distribution.Id}`,
  );
  assert.equal(distribution.DistributionConfig?.Enabled, true);
  assert(
    distribution.DistributionConfig.Aliases?.Items?.includes(
      'www.findly.barcelona',
    ),
  );
  const origins = distribution.DistributionConfig.Origins?.Items ?? [];
  const origin = origins.find(
    (candidate) =>
      candidate.Id ===
      distribution.DistributionConfig.DefaultCacheBehavior?.TargetOriginId,
  );
  assert.equal(
    origin?.DomainName,
    `${values.web_bucket_name}.s3.${region}.amazonaws.com`,
  );
  assert(origin.OriginAccessControlId, 'Private S3 origin requires OAC');
}

const basePaths = [
  'src/web',
  'src/shared',
  'public',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.web.json',
];

export function assembleRecoverySource(repository, destination) {
  // Read committed objects only; local overrides, contacts and credentials are
  // never copied. A new directory prevents stale build files joining the release.
  mkdirSync(destination, { recursive: false });
  const git = (args) =>
    execFileSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  const files = new Map();
  for (const commit of [
    recoveryRelease.baseCommit,
    recoveryRelease.recoveryCommit,
  ]) {
    assert.equal(
      git(['rev-parse', `${commit}^{commit}`])
        .toString()
        .trim(),
      commit,
    );
  }
  for (const entry of git([
    'ls-tree',
    '-rz',
    '--full-tree',
    recoveryRelease.baseCommit,
    '--',
    ...basePaths,
  ])
    .toString()
    .split('\0')
    .filter(Boolean)) {
    const [metadata, path] = entry.split('\t');
    assert(
      metadata.startsWith('100644 blob ') ||
        metadata.startsWith('100755 blob '),
      'Only regular source files may enter the release',
    );
    files.set(path, recoveryRelease.baseCommit);
  }
  for (const path of [
    ...recoveryRelease.authenticationFiles,
    ...recoveryRelease.dependencyFiles,
  ]) {
    files.set(path, recoveryRelease.recoveryCommit);
  }
  const hashes = {};
  for (const [path, commit] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const content = git(['show', `${commit}:${path}`]);
    mkdirSync(dirname(resolve(destination, path)), { recursive: true });
    writeFileSync(resolve(destination, path), content);
    hashes[path] = createHash('sha256').update(content).digest('hex');
  }
  symlinkSync(
    resolve(repository, 'node_modules'),
    resolve(destination, 'node_modules'),
    'dir',
  );
  return { ...recoveryRelease, files: hashes };
}
