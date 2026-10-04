import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { partitionManagedPolicies } from './lib/demo-role-policies.mjs';
import { productionDeploymentPolicies } from './lib/production-role-policies.mjs';

const identity = aws('sts', 'get-caller-identity');
const account = identity.Account;
assert.equal(
  account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Reviewed account mismatch',
);
assert.equal(
  identity.Arn,
  `arn:aws:iam::${account}:root`,
  'Use the approved bootstrap session',
);
const config = {
  account,
  region: 'eu-west-1',
  stateBucket: `findly-terraform-state-${account}`,
  uploadsBucket: `findly-production-uploads-${account}-eu-west-1`,
  webBucket: `findly-production-web-${account}-eu-west-1`,
};
const requireTags = (tags) => {
  const values = Array.isArray(tags)
    ? Object.fromEntries(tags.map(({ Key, Value }) => [Key, Value]))
    : tags;
  assert.equal(values?.Project, 'findly', 'Foreign project');
  assert.equal(values?.Environment, 'production', 'Foreign environment');
};
const bindings = {};
const apis = [];
let token;
do {
  const result = aws('apigatewayv2', 'get-apis', {
    MaxResults: '100',
    ...(token && { NextToken: token }),
  });
  apis.push(
    ...(result.Items ?? []).filter(
      (api) => api.Name === 'findly-production-api',
    ),
  );
  token = result.NextToken;
} while (token);
assert(apis.length <= 1, 'Ambiguous production API');
if (apis[0]) {
  requireTags(apis[0].Tags);
  bindings.apiId = apis[0].ApiId;
}
const controls = [];
let marker;
do {
  const result = aws('cloudfront', 'list-origin-access-controls', {
    MaxItems: '100',
    ...(marker && { Marker: marker }),
  }).OriginAccessControlList;
  controls.push(
    ...(result.Items ?? []).filter(
      (item) =>
        (item.Name ?? item.OriginAccessControlConfig?.Name) ===
        'findly-production-web-oac',
    ),
  );
  marker = result.IsTruncated ? result.NextMarker : undefined;
} while (marker);
assert(controls.length <= 1, 'Ambiguous production origin access control');
if (controls[0]) {
  const distributions = [];
  marker = undefined;
  do {
    const result = aws('cloudfront', 'list-distributions', {
      MaxItems: '100',
      ...(marker && { Marker: marker }),
    }).DistributionList;
    distributions.push(
      ...(result.Items ?? []).filter(
        (distribution) => distribution.Comment === 'findly-production',
      ),
    );
    marker = result.IsTruncated ? result.NextMarker : undefined;
  } while (marker);
  assert.equal(
    distributions.length,
    1,
    'An OAC binding requires its owned production distribution',
  );
  const distribution = distributions[0];
  assert.equal(distribution.ARN.split(':')[4], account);
  requireTags(
    aws('cloudfront', 'list-tags-for-resource', { Resource: distribution.ARN })
      .Tags.Items,
  );
  assert(
    distribution.Origins.Items.every(
      (origin) =>
        origin.DomainName.startsWith(`${config.webBucket}.s3.`) &&
        origin.OriginAccessControlId === controls[0].Id,
    ),
    'Foreign origin binding',
  );
  bindings.oacId = controls[0].Id;
  bindings.distributionId = distribution.Id;
}
const pools = [];
token = undefined;
do {
  const result = aws('cognito-idp', 'list-user-pools', {
    MaxResults: 60,
    ...(token && { NextToken: token }),
  });
  pools.push(
    ...(result.UserPools ?? []).filter(
      (pool) => pool.Name === 'findly-production-organizers',
    ),
  );
  token = result.NextToken;
} while (token);
assert(pools.length <= 1, 'Ambiguous production user pool');
if (pools[0]) {
  requireTags(
    aws('cognito-idp', 'describe-user-pool', { UserPoolId: pools[0].Id })
      .UserPool.UserPoolTags,
  );
  bindings.poolId = pools[0].Id;
}
const documents = productionDeploymentPolicies(config, bindings);
const policies = partitionManagedPolicies(documents.deploy);
const tags = Object.entries({
  Project: 'findly',
  Environment: 'production',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
  DataClass: 'operational',
}).map(([Key, Value]) => ({ Key, Value }));
const output = process.argv
  .find((arg) => arg.startsWith('--out-dir='))
  ?.slice(10);
if (output) {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(
    `${output}/trust.json`,
    JSON.stringify(documents.trust, null, 2),
  );
  writeFileSync(
    `${output}/boundary.json`,
    JSON.stringify(documents.boundary, null, 2),
  );
  policies.forEach((policy, index) =>
    writeFileSync(
      `${output}/deploy-${index + 1}.json`,
      JSON.stringify(policy, null, 2),
    ),
  );
}
if (!process.argv.includes('--apply')) {
  console.log(
    `Production documents prepared without AWS mutations; ${policies.length} deploy policies, runtime boundary, API/OAC bindings ${bindings.apiId && bindings.oacId ? 'present' : 'pending'}.`,
  );
  process.exit(0);
}
function upsertPolicy(name, policy) {
  const arn = `arn:aws:iam::${account}:policy/${name}`;
  let existing;
  try {
    existing = aws('iam', 'get-policy', { PolicyArn: arn }).Policy;
  } catch (error) {
    if (error.code !== 'NoSuchEntity') throw error;
  }
  if (!existing)
    aws('iam', 'create-policy', {
      PolicyName: name,
      PolicyDocument: JSON.stringify(policy),
      Tags: tags,
    });
  else {
    requireTags(existing.Tags);
    const versions = aws('iam', 'list-policy-versions', {
      PolicyArn: arn,
    }).Versions;
    if (versions.length >= 5) {
      const oldest = versions
        .filter((version) => !version.IsDefaultVersion)
        .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      assert(oldest);
      aws('iam', 'delete-policy-version', {
        PolicyArn: arn,
        VersionId: oldest.VersionId,
      });
    }
    aws('iam', 'create-policy-version', {
      PolicyArn: arn,
      PolicyDocument: JSON.stringify(policy),
      SetAsDefault: true,
    });
  }
  return arn;
}
const roleName = 'findly-production-deploy';
upsertPolicy('findly-production-runtime-boundary', documents.boundary);
let existing;
try {
  existing = aws('iam', 'get-role', { RoleName: roleName }).Role;
} catch (error) {
  if (error.code !== 'NoSuchEntity') throw error;
}
if (existing) {
  requireTags(existing.Tags);
  aws('iam', 'update-assume-role-policy', {
    RoleName: roleName,
    PolicyDocument: JSON.stringify(documents.trust),
  });
} else
  aws('iam', 'create-role', {
    RoleName: roleName,
    AssumeRolePolicyDocument: JSON.stringify(documents.trust),
    MaxSessionDuration: 3600,
    Tags: tags,
  });
for (const [index, policy] of policies.entries()) {
  const arn = upsertPolicy(`findly-production-deploy-${index + 1}`, policy);
  aws('iam', 'attach-role-policy', { RoleName: roleName, PolicyArn: arn });
}
console.log(
  'Configured production deploy role and runtime boundary; no production destroy role or stack deployment.',
);
