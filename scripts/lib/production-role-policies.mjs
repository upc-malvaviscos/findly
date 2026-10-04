import assert from 'node:assert/strict';
import { productionRolePolicies } from './demo-role-policies.mjs';

export function productionDeploymentPolicies(config, bindings = {}) {
  const { account, region, uploadsBucket, webBucket, stateBucket } = config;
  assert.match(account, /^\d{12}$/);
  assert.equal(region, 'eu-west-1');
  assert.equal(stateBucket, `findly-terraform-state-${account}`);
  assert.equal(uploadsBucket, `findly-production-uploads-${account}-eu-west-1`);
  assert.equal(webBucket, `findly-production-web-${account}-eu-west-1`);
  const arn = (service, resource) =>
    `arn:aws:${service}:${region}:${account}:${resource}`;
  const statement = (Action, Resource, Condition) => ({
    Effect: 'Allow',
    Action,
    Resource,
    ...(Condition && { Condition }),
  });
  const boundaryArn = `arn:aws:iam::${account}:policy/findly-production-runtime-boundary`;
  const documents = productionRolePolicies(config, bindings);
  const core = documents.deploy.core.Statement;
  const roles = core.find((s) => s.Action?.includes('iam:CreateRole'));
  assert(roles);
  roles.Action = roles.Action.filter((action) => action !== 'iam:CreateRole');
  core.push(
    statement(
      ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'],
      roles.Resource,
      { StringEquals: { 'iam:PermissionsBoundary': boundaryArn } },
    ),
  );
  core.push({
    Effect: 'Deny',
    Action: 'iam:DeleteRolePermissionsBoundary',
    Resource: roles.Resource,
  });
  const queueArns = ['.fifo', '-dlq.fifo', '-feedback', '-feedback-dlq'].map(
    (suffix) => arn('sqs', `findly-production-gallery-email${suffix}`),
  );
  const feedbackTopic = arn('sns', 'findly-production-gallery-email-feedback');
  const configurationSet = arn(
    'ses',
    'configuration-set/findly-production-gallery-email',
  );
  const emailWorkerArns = ['worker', 'feedback'].map((name) =>
    arn('lambda', `function:findly-production-gallery-email-${name}`),
  );
  core.push(
    statement(
      [
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
        'sqs:ListQueueTags',
        'sqs:CreateQueue',
        'sqs:SetQueueAttributes',
        'sqs:TagQueue',
        'sqs:UntagQueue',
      ],
      queueArns,
    ),
    statement(
      [
        'sns:GetTopicAttributes',
        'sns:ListTagsForResource',
        'sns:CreateTopic',
        'sns:SetTopicAttributes',
        'sns:TagResource',
        'sns:UntagResource',
      ],
      feedbackTopic,
    ),
    statement('sns:Subscribe', feedbackTopic, {
      StringEquals: {
        'sns:Protocol': 'sqs',
        'sns:Endpoint': arn('sqs', 'findly-production-gallery-email-feedback'),
      },
    }),
    // SNS authorizes subscription attribute reads against the parent topic.
    statement('sns:GetSubscriptionAttributes', feedbackTopic),
    statement(
      [
        'ses:GetConfigurationSet',
        'ses:GetConfigurationSetEventDestinations',
        'ses:CreateConfigurationSet',
        'ses:CreateConfigurationSetEventDestination',
        'ses:UpdateConfigurationSetEventDestination',
        'ses:PutConfigurationSetSuppressionOptions',
        'ses:ListTagsForResource',
        'ses:TagResource',
      ],
      configurationSet,
    ),
    statement(
      [
        'cloudwatch:DescribeAlarms',
        'cloudwatch:ListTagsForResource',
        'cloudwatch:PutMetricAlarm',
        'cloudwatch:TagResource',
        'cloudwatch:UntagResource',
      ],
      ['work', 'feedback'].map((name) =>
        arn('cloudwatch', `alarm:findly-production-gallery-email-${name}-dlq`),
      ),
    ),
    statement('lambda:CreateEventSourceMapping', '*', {
      StringEquals: {
        'aws:RequestedRegion': region,
        'aws:RequestTag/Project': 'findly',
        'aws:RequestTag/Environment': 'production',
      },
      ArnEquals: { 'lambda:FunctionArn': emailWorkerArns },
    }),
    statement(
      'lambda:UpdateEventSourceMapping',
      arn('lambda', 'event-source-mapping:*'),
      { ArnEquals: { 'lambda:FunctionArn': emailWorkerArns } },
    ),
    statement('ses:GetEmailIdentity', arn('ses', 'identity/findly.barcelona')),
    statement('ses:GetAccount', '*', {
      StringEquals: { 'aws:RequestedRegion': region },
    }),
  );
  documents.deploy.edge.Statement.push(
    statement(
      ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
      `arn:aws:acm:us-east-1:${account}:certificate/*`,
      {
        StringEquals: {
          'aws:ResourceTag/Project': 'findly',
          'aws:ResourceTag/Environment': 'shared',
        },
      },
    ),
  );
  const boundary = {
    Version: '2012-10-17',
    Statement: [
      statement(
        ['logs:CreateLogStream', 'logs:PutLogEvents'],
        arn('logs', 'log-group:/aws/lambda/findly-production-*:*'),
      ),
      statement(
        [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:ConditionCheckItem',
        ],
        [
          arn('dynamodb', 'table/findly-production'),
          arn('dynamodb', 'table/findly-production/index/*'),
        ],
      ),
      statement(
        ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        `arn:aws:s3:::${uploadsBucket}/events/*`,
      ),
      statement('s3:ListBucket', `arn:aws:s3:::${uploadsBucket}`, {
        StringLike: { 's3:prefix': 'events/*' },
      }),
      statement(
        [
          'rekognition:CreateCollection',
          'rekognition:DeleteCollection',
          'rekognition:TagResource',
          'rekognition:IndexFaces',
          'rekognition:SearchFaces',
          'rekognition:SearchFacesByImage',
          'rekognition:ListFaces',
          'rekognition:DeleteFaces',
        ],
        arn('rekognition', 'collection/findly-production-event-*'),
      ),
      statement(
        [
          'sqs:SendMessage',
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
        ],
        [...queueArns, arn('sqs', 'findly-production-photos-queue')],
      ),
      statement(
        'ses:SendEmail',
        [arn('ses', 'identity/findly.barcelona'), configurationSet],
        { StringEquals: { 'ses:FromAddress': 'info@findly.barcelona' } },
      ),
      statement('ses:GetSuppressedDestination', '*', {
        StringEquals: { 'aws:RequestedRegion': region },
      }),
      statement(
        'lambda:InvokeFunction',
        arn('lambda', 'function:findly-production-retention-purger'),
      ),
    ],
  };
  return { ...documents, boundary, boundaryArn };
}
