import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { requireDemoTags } from './lib/demo-cleanup.mjs';
import {
  demoRolePolicies,
  partitionManagedPolicies,
} from './lib/demo-role-policies.mjs';

const account = aws('sts', 'get-caller-identity').Account;
assert.equal(
  account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Reviewed account mismatch',
);
const config = {
  account,
  region: 'eu-west-1',
  stateBucket: `findly-terraform-state-${account}`,
  uploadsBucket: `findly-demo-uploads-${account}-eu-west-1`,
  webBucket: `findly-demo-web-${account}-eu-west-1`,
};
aws('s3api', 'get-bucket-versioning', { Bucket: config.stateBucket });
const bindings = {};
const apis = [];
let token;
do {
  const result = aws('apigatewayv2', 'get-apis', {
    MaxResults: '100',
    ...(token && { NextToken: token }),
  });
  apis.push(
    ...(result.Items ?? []).filter((api) => api.Name === 'findly-demo-api'),
  );
  token = result.NextToken;
} while (token);
assert(apis.length <= 1, 'Ambiguous demo API ownership');
if (apis[0]) {
  requireDemoTags(apis[0].Tags);
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
        'findly-demo-web-oac',
    ),
  );
  marker = result.IsTruncated ? result.NextMarker : undefined;
} while (marker);
assert(controls.length <= 1, 'Ambiguous demo origin access control');
if (controls[0]) bindings.oacId = controls[0].Id;
const distributions = [];
marker = undefined;
do {
  const result = aws('cloudfront', 'list-distributions', {
    MaxItems: '100',
    ...(marker && { Marker: marker }),
  }).DistributionList;
  distributions.push(
    ...(result.Items ?? []).filter((item) => item.Comment === 'findly-demo'),
  );
  marker = result.IsTruncated ? result.NextMarker : undefined;
} while (marker);
assert(distributions.length <= 1, 'Ambiguous demo distribution');
if (distributions[0]) {
  const distribution = distributions[0];
  assert.equal(distribution.ARN.split(':')[4], account);
  assert(
    distribution.Origins.Items.every((origin) =>
      origin.DomainName.startsWith(`${config.webBucket}.s3.`),
    ),
  );
  requireDemoTags(
    aws('cloudfront', 'list-tags-for-resource', { Resource: distribution.ARN })
      .Tags.Items,
  );
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
      (pool) => pool.Name === 'findly-demo-organizers',
    ),
  );
  token = result.NextToken;
} while (token);
assert(pools.length <= 1, 'Ambiguous demo user pool');
if (pools[0]) {
  requireDemoTags(
    aws('cognito-idp', 'describe-user-pool', { UserPoolId: pools[0].Id })
      .UserPool.UserPoolTags,
  );
  bindings.poolId = pools[0].Id;
}
const documents = demoRolePolicies(config, bindings);
const tags = Object.entries({
  Project: 'findly',
  Environment: 'demo',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
  DataClass: 'operational',
}).map(([Key, Value]) => ({ Key, Value }));
const destination = process.argv
  .find((arg) => arg.startsWith('--out-dir='))
  ?.slice('--out-dir='.length);
if (destination) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  writeFileSync(
    `${destination}/trust.json`,
    JSON.stringify(documents.trust, null, 2),
  );
  for (const role of ['deploy', 'destroy'])
    partitionManagedPolicies(documents[role]).forEach((policy, index) =>
      writeFileSync(
        `${destination}/${role}-${index + 1}.json`,
        JSON.stringify(policy, null, 2),
      ),
    );
}
if (!process.argv.includes('--apply')) {
  console.log(
    'Role documents prepared without AWS mutations. --apply requires the approved administrative setup session.',
  );
  process.exit(0);
}
for (const operation of ['deploy', 'destroy']) {
  const name = `findly-demo-${operation}`;
  let existing;
  try {
    existing = aws('iam', 'get-role', { RoleName: name }).Role;
  } catch (error) {
    if (error.code !== 'NoSuchEntity') throw error;
  }
  if (existing) {
    requireDemoTags(existing.Tags);
    aws('iam', 'update-assume-role-policy', {
      RoleName: name,
      PolicyDocument: JSON.stringify(documents.trust),
    });
  } else {
    aws('iam', 'create-role', {
      RoleName: name,
      AssumeRolePolicyDocument: JSON.stringify(documents.trust),
      MaxSessionDuration: 3600,
      Tags: tags,
    });
  }
  const policies = partitionManagedPolicies(documents[operation]);
  for (const [index, policy] of policies.entries()) {
    const policyName = `findly-demo-operational-${operation}-${index + 1}`;
    const arn = `arn:aws:iam::${account}:policy/${policyName}`;
    let exists = false;
    try {
      const result = aws('iam', 'get-policy', { PolicyArn: arn });
      requireDemoTags(result.Policy.Tags);
      exists = true;
    } catch (error) {
      if (error.code !== 'NoSuchEntity') throw error;
    }
    if (!exists) {
      aws('iam', 'create-policy', {
        PolicyName: policyName,
        PolicyDocument: JSON.stringify(policy),
        Tags: tags,
      });
    } else {
      const versions = aws('iam', 'list-policy-versions', {
        PolicyArn: arn,
      }).Versions;
      if (versions.length >= 5) {
        const removable = versions
          .filter((v) => !v.IsDefaultVersion)
          .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
        assert(removable);
        aws('iam', 'delete-policy-version', {
          PolicyArn: arn,
          VersionId: removable.VersionId,
        });
      }
      aws('iam', 'create-policy-version', {
        PolicyArn: arn,
        PolicyDocument: JSON.stringify(policy),
        SetAsDefault: true,
      });
    }
    aws('iam', 'attach-role-policy', { RoleName: name, PolicyArn: arn });
  }
}
console.log(
  `Configured independent demo roles; exact API/OAC bindings ${bindings.apiId && bindings.oacId ? 'present' : 'pending the bootstrap deployment'}.`,
);
