import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { sharedConfigPolicy } from './lib/shared-config-policy.mjs';

const identity = aws('sts', 'get-caller-identity');
assert.equal(
  identity.Account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Reviewed account mismatch',
);
assert.equal(
  identity.Arn,
  `arn:aws:iam::${identity.Account}:root`,
  'Use the approved bootstrap session',
);
const documents = sharedConfigPolicy(identity.Account);
const roleName = 'findly-shared-config';
const tags = Object.entries({
  Project: 'findly',
  Environment: 'shared',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
  DataClass: 'operational',
}).map(([Key, Value]) => ({ Key, Value }));
const destination = process.argv
  .find((arg) => arg.startsWith('--out='))
  ?.slice(6);
if (destination) writeFileSync(destination, JSON.stringify(documents, null, 2));
if (!process.argv.includes('--apply')) {
  console.log('Shared configuration role prepared without AWS mutations.');
  process.exit(0);
}
let existing;
try {
  existing = aws('iam', 'get-role', { RoleName: roleName }).Role;
} catch (error) {
  if (error.code !== 'NoSuchEntity') throw error;
}
if (existing) {
  const actual = Object.fromEntries(
    existing.Tags.map(({ Key, Value }) => [Key, Value]),
  );
  assert.equal(actual.Project, 'findly');
  assert.equal(actual.Environment, 'shared');
  aws('iam', 'update-assume-role-policy', {
    RoleName: roleName,
    PolicyDocument: JSON.stringify(documents.trust),
  });
} else {
  aws('iam', 'create-role', {
    RoleName: roleName,
    AssumeRolePolicyDocument: JSON.stringify(documents.trust),
    MaxSessionDuration: 3600,
    Tags: tags,
  });
}
aws('iam', 'put-role-policy', {
  RoleName: roleName,
  PolicyName: 'shared-domain-configuration',
  PolicyDocument: JSON.stringify(documents.policy),
});
console.log(
  'Configured findly-shared-config; no send, IAM administration, or shared resource deletion permissions.',
);
