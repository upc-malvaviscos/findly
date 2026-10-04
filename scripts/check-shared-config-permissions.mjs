import assert from 'node:assert/strict';
import { awsCommand as aws } from './lib/aws-command.mjs';

const { Account: account } = aws('sts', 'get-caller-identity');
assert.equal(
  account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Reviewed account mismatch',
);
const certificate = `arn:aws:acm:us-east-1:${account}:certificate/00000000-0000-0000-0000-000000000000`;
const tags = {
  'aws:RequestTag/Project': 'findly',
  'aws:RequestTag/Environment': 'shared',
  'aws:ResourceTag/Project': 'findly',
  'aws:ResourceTag/Environment': 'shared',
};
const cases = [
  ['acm:AddTagsToCertificate', certificate, tags, 'allowed'],
  [
    'acm:AddTagsToCertificate',
    certificate,
    { ...tags, 'aws:ResourceTag/Project': 'foreign' },
    'implicitDeny',
  ],
  [
    'acm:AddTagsToCertificate',
    certificate,
    { ...tags, 'aws:ResourceTag/Environment': 'production' },
    'implicitDeny',
  ],
  [
    'ses:SendEmail',
    `arn:aws:ses:eu-west-1:${account}:identity/findly.barcelona`,
    {},
    'implicitDeny',
  ],
  [
    'iam:CreateRole',
    `arn:aws:iam::${account}:role/findly-production-deploy`,
    {},
    'implicitDeny',
  ],
  [
    's3:GetObject',
    `arn:aws:s3:::findly-terraform-state-${account}/findly/production/terraform.tfstate`,
    {},
    'implicitDeny',
  ],
  [
    's3:DeleteObject',
    `arn:aws:s3:::findly-terraform-state-${account}/findly/shared/email-identity/terraform.tfstate`,
    {},
    'implicitDeny',
  ],
  [
    's3:PutObject',
    `arn:aws:s3:::findly-terraform-state-${account}/findly/shared/email-identity/terraform.tfstate`,
    {},
    'allowed',
  ],
];
for (const [action, resource, context, expected] of cases) {
  const result = aws('iam', 'simulate-principal-policy', {
    PolicySourceArn: `arn:aws:iam::${account}:role/findly-shared-config`,
    ActionNames: [action],
    ResourceArns: [resource],
    ContextEntries: Object.entries(context).map(([ContextKeyName, value]) => ({
      ContextKeyName,
      ContextKeyValues: [value],
      ContextKeyType: 'string',
    })),
  });
  assert.equal(
    result.EvaluationResults[0].EvalDecision,
    expected,
    `Unexpected access: ${action}`,
  );
}
console.log(
  `AWS IAM Simulator verified ${cases.length} shared-role boundaries; this does not prove SES delivery or Terraform apply.`,
);
