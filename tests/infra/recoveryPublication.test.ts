import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assembleRecoverySource,
  authorizeRecoveryPublication,
  publicRecoveryOutputs,
  recoveryRelease,
  verifyRecoveryDestinations,
} from '../../scripts/lib/recovery-publication.mjs';

const env = {
  GITHUB_REPOSITORY: 'upc-malvaviscos/findly',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_ACTOR: 'anyulled',
  GITHUB_TRIGGERING_ACTOR: 'anyulled',
  TARGET_ENVIRONMENT: 'production',
  TF_WORKSPACE: 'default',
  FINDLY_AWS_ACCOUNT_ID: '567158658992',
  AWS_REGION: 'eu-west-1',
  STATE_BUCKET: 'findly-terraform-state-567158658992',
  ROLE_ARN: 'arn:aws:iam::567158658992:role/findly-production-deploy',
};
const values = {
  api_id: 'syntheticapi',
  api_endpoint: 'https://syntheticapi.execute-api.eu-west-1.amazonaws.com',
  cognito_user_pool_id: 'eu-west-1_73pdc5T9W',
  cognito_client_id: 'syntheticclient',
  cognito_region: 'eu-west-1',
  web_bucket_name: 'findly-production-web-567158658992-eu-west-1',
  web_distribution_id: 'SYNTHETIC',
  frontend_origin: 'https://www.findly.barcelona',
};
const state = () => ({
  outputs: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  ),
});
const live = () => ({
  identity: {
    Account: '567158658992',
    Arn: 'arn:aws:sts::567158658992:assumed-role/findly-production-deploy/synthetic',
  },
  api: {
    ApiId: values.api_id,
    ApiEndpoint: values.api_endpoint,
    ProtocolType: 'HTTP',
  },
  pool: {
    Id: values.cognito_user_pool_id,
    Name: 'findly-production-organizers',
    Arn: `arn:aws:cognito-idp:eu-west-1:567158658992:userpool/${values.cognito_user_pool_id}`,
  },
  client: {
    UserPoolId: values.cognito_user_pool_id,
    ClientId: values.cognito_client_id,
    ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH'],
  },
  distribution: {
    Id: values.web_distribution_id,
    ARN: `arn:aws:cloudfront::567158658992:distribution/${values.web_distribution_id}`,
    DistributionConfig: {
      Enabled: true,
      Aliases: { Items: ['www.findly.barcelona'] },
      DefaultCacheBehavior: { TargetOriginId: 'web' },
      Origins: {
        Items: [
          {
            Id: 'web',
            DomainName: `${values.web_bucket_name}.s3.eu-west-1.amazonaws.com`,
            OriginAccessControlId: 'synthetic-oac',
          },
        ],
      },
    },
  },
});

describe('limited recovery publication (local source and simulated AWS metadata)', () => {
  it('requires the existing production boundary before credentials', () => {
    expect(() => authorizeRecoveryPublication(env)).not.toThrow();
    for (const change of [
      { GITHUB_REF: 'refs/heads/fix/recovery' },
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_TRIGGERING_ACTOR: 'outside' },
      { FINDLY_AWS_ACCOUNT_ID: '123456789012' },
      { ROLE_ARN: 'arn:aws:iam::567158658992:role/findly-organizer-recovery' },
      { AWS_REGION: 'eu-central-1' },
      { SHARED_CONFIGURATION: 'true' },
    ])
      expect(() =>
        authorizeRecoveryPublication({ ...env, ...change }),
      ).toThrow();
  });
  it('selects only validated public outputs, never state resources', () => {
    expect(
      publicRecoveryOutputs({
        ...state(),
        resources: [{ private: 'synthetic-do-not-export' }],
      }),
    ).toEqual(values);
    for (const value of [
      'https://foreign.example',
      'https://www.findly.barcelona\nINJECT=true',
    ]) {
      const data = state();
      data.outputs.frontend_origin = { value };
      expect(() => publicRecoveryOutputs(data)).toThrow();
    }
    const data = state();
    expect(() =>
      publicRecoveryOutputs({
        outputs: {
          ...data.outputs,
          cognito_client_id: { value: 'secret', sensitive: true },
        },
      }),
    ).toThrow();
    expect(() => publicRecoveryOutputs({ outputs: {} })).toThrow();
  });
  it('rejects foreign live resources, client secrets and a foreign default origin', () => {
    expect(() => verifyRecoveryDestinations(values, live())).not.toThrow();
    const fixtures = [
      {
        ...live(),
        identity: {
          Account: '567158658992',
          Arn: 'arn:aws:iam::567158658992:root',
        },
      },
      { ...live(), api: { ...live().api, ApiId: 'foreign' } },
      {
        ...live(),
        client: { ...live().client, ClientSecret: 'synthetic-secret' },
      },
      { ...live(), pool: { ...live().pool, Name: 'foreign' } },
      {
        ...live(),
        distribution: {
          ...live().distribution,
          ARN: 'arn:aws:cloudfront::123456789012:distribution/FOREIGN',
        },
      },
      {
        ...live(),
        distribution: {
          ...live().distribution,
          DistributionConfig: {
            ...live().distribution.DistributionConfig,
            DefaultCacheBehavior: { TargetOriginId: 'foreign' },
          },
        },
      },
    ];
    for (const fixture of fixtures)
      expect(() => verifyRecoveryDestinations(values, fixture)).toThrow();
  });
  it('composes every application byte from the production base except five authentication files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'findly-recovery-source-'));
    try {
      const source = join(directory, 'source');
      const manifest = assembleRecoverySource(process.cwd(), source);
      const replaced = [
        ...recoveryRelease.authenticationFiles,
        ...recoveryRelease.dependencyFiles,
      ];
      expect(
        manifest.files['src/web/components/admin/EventPhotoManager.tsx'],
      ).toBeUndefined();
      expect(
        manifest.files['src/web/components/admin/PasswordRecoveryForm.tsx'],
      ).toBeDefined();
      for (const [path, hash] of Object.entries(manifest.files)) {
        const commit = replaced.includes(path)
          ? recoveryRelease.recoveryCommit
          : recoveryRelease.baseCommit;
        const expected = execFileSync('git', ['show', `${commit}:${path}`]);
        expect(readFileSync(join(source, path)).equals(expected)).toBe(true);
        expect(createHash('sha256').update(expected).digest('hex')).toBe(hash);
      }
      expect(() => assembleRecoverySource(process.cwd(), source)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
