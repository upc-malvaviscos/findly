import { describe, expect, it } from 'vitest';
import {
  authorizeDemo,
  demoConfiguration,
  destroyConfirmation,
  validateDestroyPlan,
} from '../../scripts/lib/demo-controls.mjs';

const context = {
  repository: 'upc-malvaviscos/findly',
  ref: 'refs/heads/main',
  event: 'workflow_dispatch',
  actor: 'anyulled',
  triggeringActor: 'surinyach',
  environment: 'demo',
  operation: 'deploy',
};
const env = {
  FINDLY_AWS_ACCOUNT_ID: '123456789012',
  AWS_REGION: 'eu-west-1',
  TF_WORKSPACE: 'default',
  STATE_BUCKET: 'findly-terraform-state-123456789012',
  TF_VAR_uploads_bucket_name: 'findly-demo-uploads-123456789012-eu-west-1',
  TF_VAR_web_bucket_name: 'findly-demo-web-123456789012-eu-west-1',
  ROLE_ARN: 'arn:aws:iam::123456789012:role/findly-demo-deploy',
  DEMO_OPERATION: 'deploy',
};
const config = demoConfiguration(env);
const bucket = (name = config.uploadsBucket) => ({
  address: 'module.findly.module.uploads_bucket.aws_s3_bucket.uploads',
  mode: 'managed',
  type: 'aws_s3_bucket',
  change: {
    actions: ['delete'],
    before: {
      id: name,
      bucket: name,
      tags_all: {
        Project: 'findly',
        Environment: 'demo',
        ManagedBy: 'Terraform',
        CostCenter: 'findly',
      },
    },
    after: null,
  },
});

describe('demo authorization before credentials', () => {
  it.each(['anyulled', 'orLuzuriaga', 'raati5674', 'surinyach'])(
    'accepts %s',
    (actor) => {
      expect(() =>
        authorizeDemo({ ...context, actor, triggeringActor: actor }),
      ).not.toThrow();
    },
  );
  it.each([
    { actor: 'outside' },
    { triggeringActor: 'outside' },
    { ref: 'refs/heads/feature' },
    { repository: 'another/findly' },
    { environment: 'production' },
    { event: 'pull_request' },
    { operation: 'unknown' },
    { operation: 'destroy' },
  ])('rejects unsafe context %j', (changes) =>
    expect(() => authorizeDemo({ ...context, ...changes })).toThrow(),
  );
  it('requires the exact destructive confirmation', () => {
    expect(() =>
      authorizeDemo({
        ...context,
        operation: 'destroy',
        confirmation: destroyConfirmation,
      }),
    ).not.toThrow();
  });
  it.each([
    { STATE_BUCKET: 'another' },
    { TF_VAR_uploads_bucket_name: env.STATE_BUCKET },
    { AWS_REGION: 'us-east-1' },
    { ROLE_ARN: 'arn:aws:iam::123456789012:role/findly-pr-90' },
    { FINDLY_AWS_ACCOUNT_ID: 'invalid' },
    { TF_WORKSPACE: 'another' },
  ])('rejects arbitrary external configuration %j', (changes) =>
    expect(() => demoConfiguration({ ...env, ...changes })).toThrow(),
  );
});

describe('demo destruction inventory', () => {
  it('protects operational roles even if a corrupted stack address references them', () => {
    expect(() =>
      validateDestroyPlan(
        {
          resource_changes: [
            {
              address:
                'module.findly.module.gallery_reader.aws_iam_role.gallery_reader',
              mode: 'managed',
              type: 'aws_iam_role',
              change: {
                actions: ['delete'],
                before: { name: 'findly-demo-destroy' },
                after: null,
              },
            },
          ],
        },
        config,
      ),
    ).toThrow('Operational roles');
  });
  it('accepts the owned demo bucket and an empty recovered stack', () => {
    expect(
      validateDestroyPlan({ resource_changes: [bucket()] }, config).buckets,
    ).toEqual([config.uploadsBucket]);
    expect(
      validateDestroyPlan({ resource_changes: [] }, config).resources,
    ).toEqual([]);
  });
  it('protects the shared backend and foreign buckets', () => {
    for (const name of [config.stateBucket, 'findly-sandbox-123456789012'])
      expect(() =>
        validateDestroyPlan({ resource_changes: [bucket(name)] }, config),
      ).toThrow();
  });
  it('rejects unknown resource addresses, wrong tags and replacements', () => {
    const r = bucket();
    expect(() =>
      validateDestroyPlan(
        { resource_changes: [{ ...r, address: 'aws_s3_bucket.state' }] },
        config,
      ),
    ).toThrow();
    expect(() =>
      validateDestroyPlan(
        {
          resource_changes: [
            { ...r, change: { ...r.change, actions: ['delete', 'create'] } },
          ],
        },
        config,
      ),
    ).toThrow();
    r.change.before.tags_all.Environment = 'sandbox';
    expect(() =>
      validateDestroyPlan({ resource_changes: [r] }, config),
    ).toThrow();
  });
  it('rejects a child attached to an uninventoried API', () => {
    expect(() =>
      validateDestroyPlan(
        {
          resource_changes: [
            {
              address:
                'module.findly.module.api_gateway.aws_apigatewayv2_stage.default',
              mode: 'managed',
              type: 'aws_apigatewayv2_stage',
              change: {
                actions: ['delete'],
                before: { api_id: 'foreign' },
                after: null,
              },
            },
          ],
        },
        config,
      ),
    ).toThrow('API child');
  });
});
