import assert from 'node:assert/strict';

const actors = ['anyulled', 'orLuzuriaga', 'raati5674', 'surinyach'];

export function authorizeProduction(env) {
  assert.equal(
    env.GITHUB_REPOSITORY,
    'upc-malvaviscos/findly',
    'Unapproved repository',
  );
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Production requires main');
  assert.equal(
    env.GITHUB_EVENT_NAME,
    'workflow_dispatch',
    'Manual execution required',
  );
  assert.equal(env.TARGET_ENVIRONMENT, 'production', 'Wrong environment');
  assert(actors.includes(env.GITHUB_ACTOR), 'Unapproved original actor');
  assert(
    actors.includes(env.GITHUB_TRIGGERING_ACTOR),
    'Unapproved rerun actor',
  );
  assert.equal(
    env.TF_WORKSPACE,
    'default',
    'Only the default workspace is allowed',
  );
  assert.match(
    env.FINDLY_AWS_ACCOUNT_ID ?? '',
    /^\d{12}$/,
    'Missing reviewed account',
  );
  assert.equal(
    env.STATE_BUCKET,
    `findly-terraform-state-${env.FINDLY_AWS_ACCOUNT_ID}`,
    'Unapproved state bucket',
  );
  assert.equal(
    env.ROLE_ARN,
    `arn:aws:iam::${env.FINDLY_AWS_ACCOUNT_ID}:role/${env.SHARED_CONFIGURATION === 'true' ? 'findly-shared-config' : 'findly-production-deploy'}`,
    'Unapproved role',
  );
  if (env.SHARED_CONFIGURATION !== 'true') {
    assert.equal(
      env.TF_VAR_uploads_bucket_name,
      `findly-production-uploads-${env.FINDLY_AWS_ACCOUNT_ID}-eu-west-1`,
      'Unapproved uploads bucket',
    );
    assert.equal(
      env.TF_VAR_web_bucket_name,
      `findly-production-web-${env.FINDLY_AWS_ACCOUNT_ID}-eu-west-1`,
      'Unapproved web bucket',
    );
  }
}
