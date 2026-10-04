import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { validateEmailAcceptanceManifest } from './lib/email-acceptance-manifest.mjs';
import { emailAcceptancePolicy } from './lib/email-acceptance-policy.mjs';
import { partitionManagedPolicies } from './lib/demo-role-policies.mjs';

const arg = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const repository = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const outsideRepository = (path) =>
  assert(
    path !== repository && !path.startsWith(`${repository}/`),
    'Keep private manifests and policy documents outside the repository',
  );
assert(
  arg('manifest') && arg('outputs'),
  'Private --manifest= and deployed --outputs= files are required',
);
outsideRepository(realpathSync(arg('manifest')));
assert(
  (statSync(arg('manifest')).mode & 0o077) === 0,
  'Manifest must be readable only by its owner',
);
const manifest = validateEmailAcceptanceManifest(
  JSON.parse(readFileSync(arg('manifest'), 'utf8')),
);
const outputs = JSON.parse(readFileSync(arg('outputs'), 'utf8'));
const value = (name) => outputs[name]?.value;
const caller = aws('sts', 'get-caller-identity');
assert.equal(caller.Account, manifest.account, 'Wrong account');
assert.equal(
  caller.Account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Wrong reviewed account',
);
assert.equal(
  caller.Arn,
  `arn:aws:iam::${manifest.account}:root`,
  'Use only the approved IAM bootstrap session',
);
assert.equal(value('table_name'), 'findly-production');
const bucket = `findly-production-uploads-${manifest.account}-eu-west-1`;
assert.equal(value('uploads_bucket_name'), bucket);
assert.equal(value('frontend_origin'), 'https://www.findly.barcelona');
assert.match(value('api_id'), /^[a-z0-9]+$/);
assert.match(value('cognito_user_pool_id'), /^eu-west-1_[A-Za-z0-9]+$/);
assert.match(value('web_distribution_id'), /^[A-Z0-9]+$/);
const owned = (tags) => {
  const actual = Array.isArray(tags)
    ? Object.fromEntries(tags.map(({ Key, Value }) => [Key, Value]))
    : tags;
  assert(
    actual?.Project === 'findly' && actual?.Environment === 'production',
    'Foreign resource ownership',
  );
};
const api = aws('apigatewayv2', 'get-api', { ApiId: value('api_id') });
assert.equal(api.Name, 'findly-production-api');
owned(api.Tags);
const pool = aws('cognito-idp', 'describe-user-pool', {
  UserPoolId: value('cognito_user_pool_id'),
}).UserPool;
assert.equal(pool.Name, 'findly-production-organizers');
owned(pool.UserPoolTags);
const distribution = aws('cloudfront', 'get-distribution', {
  Id: value('web_distribution_id'),
}).Distribution;
assert.equal(
  distribution.ARN,
  `arn:aws:cloudfront::${manifest.account}:distribution/${value('web_distribution_id')}`,
);
owned(
  aws('cloudfront', 'list-tags-for-resource', { Resource: distribution.ARN })
    .Tags.Items,
);
assert(
  distribution.DistributionConfig.Aliases.Items.includes(
    'www.findly.barcelona',
  ),
  'Foreign HTTPS domain',
);
assert(
  distribution.DistributionConfig.Origins.Items.every((origin) =>
    origin.DomainName.startsWith(
      `findly-production-web-${manifest.account}-eu-west-1.s3.`,
    ),
  ),
  'Foreign web bucket',
);
owned(
  aws('dynamodb', 'list-tags-of-resource', {
    ResourceArn: `arn:aws:dynamodb:eu-west-1:${manifest.account}:table/findly-production`,
  }).Tags,
);
owned(aws('s3api', 'get-bucket-tagging', { Bucket: bucket }).TagSet);
assert(
  !aws('s3api', 'get-bucket-versioning', { Bucket: bucket }).Status,
  'Versioned bucket cleanup requires a separately reviewed design',
);
const documents = emailAcceptancePolicy(manifest);
const policies = partitionManagedPolicies({
  core: documents.policy,
  edge: { Version: '2012-10-17', Statement: [] },
});
const tags = Object.entries({
  Project: 'findly',
  Environment: 'production',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
  DataClass: 'operational',
}).map(([Key, Value]) => ({ Key, Value }));
if (arg('out-dir')) {
  outsideRepository(resolve(arg('out-dir')));
  mkdirSync(arg('out-dir'), { recursive: true, mode: 0o700 });
  outsideRepository(realpathSync(arg('out-dir')));
  writeFileSync(
    `${arg('out-dir')}/trust.json`,
    JSON.stringify(documents.trust, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
  policies.forEach((policy, index) =>
    writeFileSync(
      `${arg('out-dir')}/operator-${index + 1}.json`,
      JSON.stringify(policy, null, 2),
      { mode: 0o600, flag: 'wx' },
    ),
  );
}
if (!process.argv.includes('--apply')) {
  console.log(
    `Owned production outputs verified; prepared ${policies.length} bounded IAM policies without mutations.`,
  );
  process.exit(0);
}
const roleName = 'findly-production-email-acceptance';
let existing;
try {
  existing = aws('iam', 'get-role', { RoleName: roleName }).Role;
} catch (error) {
  if (error.code !== 'NoSuchEntity') throw error;
}
if (existing) {
  owned(existing.Tags);
  assert.equal(
    aws('iam', 'list-role-policies', { RoleName: roleName }).PolicyNames.length,
    0,
    'Unexpected inline permissions',
  );
  const attached = aws('iam', 'list-attached-role-policies', {
    RoleName: roleName,
  }).AttachedPolicies;
  assert(
    attached.every(({ PolicyArn }) =>
      new RegExp(
        `^arn:aws:iam::${manifest.account}:policy/${roleName}-[1-9][0-9]*$`,
      ).test(PolicyArn),
    ),
    'Unexpected attached permissions',
  );
  for (const { PolicyArn } of attached)
    if (Number(PolicyArn.split('-').at(-1)) > policies.length)
      aws('iam', 'detach-role-policy', { RoleName: roleName, PolicyArn });
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
  const name = `${roleName}-${index + 1}`;
  const PolicyArn = `arn:aws:iam::${manifest.account}:policy/${name}`;
  let present;
  try {
    present = aws('iam', 'get-policy', { PolicyArn }).Policy;
  } catch (error) {
    if (error.code !== 'NoSuchEntity') throw error;
  }
  if (!present)
    aws('iam', 'create-policy', {
      PolicyName: name,
      PolicyDocument: JSON.stringify(policy),
      Tags: tags,
    });
  else {
    owned(present.Tags);
    const versions = aws('iam', 'list-policy-versions', { PolicyArn }).Versions;
    if (versions.length >= 5) {
      const oldest = versions
        .filter((version) => !version.IsDefaultVersion)
        .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      aws('iam', 'delete-policy-version', {
        PolicyArn,
        VersionId: oldest.VersionId,
      });
    }
    aws('iam', 'create-policy-version', {
      PolicyArn,
      PolicyDocument: JSON.stringify(policy),
      SetAsDefault: true,
    });
  }
  aws('iam', 'attach-role-policy', { RoleName: roleName, PolicyArn });
}
console.log(
  'Configured only the approved acceptance IAM role/policies; no production fixtures or resources created.',
);
