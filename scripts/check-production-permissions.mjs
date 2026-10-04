import assert from 'node:assert/strict';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { productionDeploymentPolicies } from './lib/production-role-policies.mjs';
import { partitionManagedPolicies } from './lib/demo-role-policies.mjs';

const { Account: account } = aws('sts', 'get-caller-identity');
assert.equal(
  account,
  process.env.FINDLY_AWS_ACCOUNT_ID,
  'Reviewed account mismatch',
);
const documents = productionDeploymentPolicies({
  account,
  region: 'eu-west-1',
  stateBucket: `findly-terraform-state-${account}`,
  uploadsBucket: `findly-production-uploads-${account}-eu-west-1`,
  webBucket: `findly-production-web-${account}-eu-west-1`,
});
const policies = partitionManagedPolicies(documents.deploy).map((policy) =>
  JSON.stringify(policy),
);
const runtime = `arn:aws:iam::${account}:role/findly-production-gallery-email-worker`;
const cases = [
  [
    'iam:CreateRole',
    runtime,
    { 'iam:PermissionsBoundary': documents.boundaryArn },
    'allowed',
  ],
  ['iam:CreateRole', runtime, {}, 'implicitDeny'],
  [
    'iam:CreateRole',
    runtime,
    { 'iam:PermissionsBoundary': `arn:aws:iam::${account}:policy/foreign` },
    'implicitDeny',
  ],
  [
    'iam:CreateRole',
    `arn:aws:iam::${account}:role/findly-demo-public-register`,
    { 'iam:PermissionsBoundary': documents.boundaryArn },
    'implicitDeny',
  ],
  ['iam:DeleteRolePermissionsBoundary', runtime, {}, 'explicitDeny'],
  [
    'iam:PutRolePolicy',
    `arn:aws:iam::${account}:role/findly-production-deploy`,
    {},
    'explicitDeny',
  ],
  ['iam:CreatePolicyVersion', documents.boundaryArn, {}, 'implicitDeny'],
  [
    'ses:SendEmail',
    `arn:aws:ses:eu-west-1:${account}:identity/findly.barcelona`,
    {},
    'implicitDeny',
  ],
  [
    's3:GetObject',
    `arn:aws:s3:::findly-terraform-state-${account}/findly/demo/terraform.tfstate`,
    {},
    'implicitDeny',
  ],
];
const requestTags = {
  'aws:RequestTag/Project': 'findly',
  'aws:RequestTag/Environment': 'production',
  'aws:RequestTag/ManagedBy': 'Terraform',
  'aws:RequestTag/CostCenter': 'findly',
  'aws:RequestedRegion': 'eu-west-1',
};
cases.push(['cloudfront:CreateDistribution', '*', requestTags, 'allowed']);
for (const [action, resource] of [
  [
    'cloudfront:TagResource',
    `arn:aws:cloudfront::${account}:distribution/REVIEWFIXTURE`,
  ],
  [
    'cognito-idp:TagResource',
    `arn:aws:cognito-idp:eu-west-1:${account}:userpool/eu-west-1_reviewfixture`,
  ],
  [
    'apigateway:POST',
    'arn:aws:apigateway:eu-west-1::/tags/arn%3Aaws%3Aapigateway%3Aeu-west-1%3A%3A%2Fv2%2Fapis%2Freviewfixture',
  ],
]) {
  cases.push(
    [action, resource, requestTags, 'implicitDeny'],
    [
      action,
      resource,
      {
        ...requestTags,
        'aws:ResourceTag/Project': 'findly',
        'aws:ResourceTag/Environment': 'demo',
      },
      'implicitDeny',
    ],
    [
      action,
      resource,
      {
        ...requestTags,
        'aws:ResourceTag/Project': 'findly',
        'aws:ResourceTag/Environment': 'production',
      },
      'allowed',
    ],
  );
}
for (const [action, resource, context, expected] of cases) {
  const result = aws('iam', 'simulate-custom-policy', {
    PolicyInputList: policies,
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
    `Unexpected deployment permission: ${action}`,
  );
}
console.log(
  `AWS IAM Simulator verified ${cases.length} production deploy policy boundaries without creating a role or deploying resources.`,
);
// The current SNS reference scopes GetSubscriptionAttributes to its topic:
// https://docs.aws.amazon.com/service-authorization/latest/reference/list_sns.html
// IAM Simulator returns implicitDeny with either topic or subscription ResourceArns,
// even for an Allow Resource='*' policy. Validate the actual topic-scoped read
// after deploying the subscription; simulator success does not establish it.
console.log(
  'SNS GetSubscriptionAttributes remains pending verification against the deployed subscription; IAM Simulator cannot verify its documented topic resource scope.',
);
