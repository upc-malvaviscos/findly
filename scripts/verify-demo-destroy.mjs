import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { demoConfiguration } from './lib/demo-controls.mjs';
import { demoCollectionIds } from './lib/demo-cleanup.mjs';

const config = demoConfiguration(process.env);
const inventory = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const state = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const flatten = (module) => [
  ...(module?.resources ?? []),
  ...(module?.child_modules ?? []).flatMap(flatten),
];
assert.equal(
  flatten(state.values?.root_module).filter((r) => r.mode === 'managed').length,
  0,
  'Demo state is not empty',
);
assert.equal(
  demoCollectionIds(aws, config).length,
  0,
  'Demo collections remain',
);
const absence = {
  aws_s3_bucket: [
    's3api',
    'get-bucket-location',
    (v) => ({ Bucket: v.bucket }),
    ['NoSuchBucket'],
  ],
  aws_dynamodb_table: [
    'dynamodb',
    'describe-table',
    (v) => ({ TableName: v.name }),
    ['ResourceNotFoundException'],
  ],
  aws_lambda_function: [
    'lambda',
    'get-function',
    (v) => ({ FunctionName: v.function_name }),
    ['ResourceNotFoundException'],
  ],
  aws_iam_role: [
    'iam',
    'get-role',
    (v) => ({ RoleName: v.name }),
    ['NoSuchEntity'],
  ],
  aws_cloudfront_distribution: [
    'cloudfront',
    'get-distribution',
    (v) => ({ Id: v.id }),
    ['NoSuchDistribution'],
  ],
  aws_cloudfront_origin_access_control: [
    'cloudfront',
    'get-origin-access-control',
    (v) => ({ Id: v.id }),
    ['NoSuchOriginAccessControl'],
  ],
  aws_apigatewayv2_api: [
    'apigatewayv2',
    'get-api',
    (v) => ({ ApiId: v.id }),
    ['NotFoundException'],
  ],
  aws_cognito_user_pool: [
    'cognito-idp',
    'describe-user-pool',
    (v) => ({ UserPoolId: v.id }),
    ['ResourceNotFoundException'],
  ],
  aws_sns_topic: [
    'sns',
    'get-topic-attributes',
    (v) => ({ TopicArn: v.arn }),
    ['NotFound'],
  ],
  aws_sqs_queue: [
    'sqs',
    'get-queue-attributes',
    (v) => ({ QueueUrl: v.id, AttributeNames: ['QueueArn'] }),
    ['AWS.SimpleQueueService.NonExistentQueue', 'QueueDoesNotExist'],
  ],
  aws_scheduler_schedule: [
    'scheduler',
    'get-schedule',
    (v) => ({ Name: v.name, GroupName: v.group_name ?? 'default' }),
    ['ResourceNotFoundException'],
  ],
};
for (const resource of inventory.resources) {
  const v = resource.value;
  const probe = absence[resource.type];
  if (probe) {
    const [service, command, input, missing] = probe;
    let removed = false;
    try {
      aws(service, command, input(v));
    } catch (error) {
      if (!missing.includes(error.code)) throw error;
      removed = true;
    }
    assert(removed, `Demo resource remains: ${resource.address}`);
  } else if (resource.type === 'aws_cloudwatch_log_group') {
    const groups =
      aws('logs', 'describe-log-groups', { LogGroupNamePrefix: v.name })
        .logGroups ?? [];
    assert(!groups.some((g) => g.logGroupName === v.name), 'Demo logs remain');
  } else if (resource.type === 'aws_cloudwatch_metric_alarm') {
    const alarms =
      aws('cloudwatch', 'describe-alarms', { AlarmNames: [v.alarm_name] })
        .MetricAlarms ?? [];
    assert.equal(alarms.length, 0, 'Demo alarm remains');
  }
}
// The backend is deliberately outside the destroy inventory and still usable.
assert.equal(
  aws('s3api', 'get-bucket-versioning', { Bucket: config.stateBucket }).Status,
  'Enabled',
);
const block = aws('s3api', 'get-public-access-block', {
  Bucket: config.stateBucket,
}).PublicAccessBlockConfiguration;
assert(
  Object.values(block).every(Boolean),
  'Shared backend public-access protection changed',
);
aws('s3api', 'get-bucket-encryption', { Bucket: config.stateBucket });
console.log(
  'Verified: demo state empty, inventoried stack and collections absent, shared backend preserved.',
);
