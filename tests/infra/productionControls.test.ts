import { describe, expect, it } from 'vitest';
import { authorizeProduction } from '../../scripts/lib/production-controls.mjs';

const env = {
  GITHUB_REPOSITORY: 'upc-malvaviscos/findly',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_ACTOR: 'anyulled',
  GITHUB_TRIGGERING_ACTOR: 'surinyach',
  TARGET_ENVIRONMENT: 'production',
  SHARED_CONFIGURATION: 'true',
  TF_WORKSPACE: 'default',
  FINDLY_AWS_ACCOUNT_ID: '123456789012',
  STATE_BUCKET: 'findly-terraform-state-123456789012',
  ROLE_ARN: 'arn:aws:iam::123456789012:role/findly-shared-config',
};

describe('production credential boundary', () => {
  it('accepts authorized manual main execution and its authorized rerun', () => {
    expect(() => authorizeProduction(env)).not.toThrow();
  });
  it.each([
    { GITHUB_ACTOR: 'outside' },
    { GITHUB_TRIGGERING_ACTOR: 'outside' },
    { GITHUB_REF: 'refs/heads/feature/issue-98' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_REPOSITORY: 'fork/findly' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { TARGET_ENVIRONMENT: 'demo' },
    { STATE_BUCKET: 'foreign' },
    { TF_WORKSPACE: 'alternate' },
    { ROLE_ARN: 'arn:aws:iam::123456789012:role/findly-demo-deploy' },
    { FINDLY_AWS_ACCOUNT_ID: '000000000000' },
    { SHARED_CONFIGURATION: 'false' },
  ])('rejects unsafe execution before credentials: %j', (changes) => {
    expect(() => authorizeProduction({ ...env, ...changes })).toThrow();
  });
});
