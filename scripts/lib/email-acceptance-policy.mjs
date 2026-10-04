import assert from 'node:assert/strict';
import { validateEmailAcceptanceManifest } from './email-acceptance-manifest.mjs';

export function emailAcceptancePolicy(input, options = {}) {
  const manifest = validateEmailAcceptanceManifest(input, options);
  const { account, region } = manifest;
  const arn = (service, resource) =>
    `arn:aws:${service}:${region}:${account}:${resource}`;
  const allow = (Action, Resource, Condition) => ({
    Effect: 'Allow',
    Action,
    Resource,
    ...(Condition && { Condition }),
  });
  const table = arn('dynamodb', 'table/findly-production');
  const bucket = `arn:aws:s3:::findly-production-uploads-${account}-eu-west-1`;
  const prefix = manifest.fixtures.map(({ eventId }) => `events/${eventId}/*`);
  const queues = ['.fifo', '-dlq.fifo', '-feedback', '-feedback-dlq'].map(
    (suffix) => arn('sqs', `findly-production-gallery-email${suffix}`),
  );
  const statements = [
    allow(
      [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
      ],
      table,
      {
        'ForAllValues:StringEquals': {
          'dynamodb:LeadingKeys': manifest.leadingKeys,
        },
        Null: { 'dynamodb:LeadingKeys': 'false' },
      },
    ),
    allow(
      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      prefix.map((key) => `${bucket}/${key}`),
    ),
    allow('s3:ListBucket', bucket, { StringLike: { 's3:prefix': prefix } }),
    allow('s3:GetBucketVersioning', bucket),
    allow(
      [
        'rekognition:CreateCollection',
        'rekognition:TagResource',
        'rekognition:DescribeCollection',
        'rekognition:DeleteCollection',
      ],
      manifest.fixtures.map(({ collectionId }) =>
        arn('rekognition', `collection/${collectionId}`),
      ),
    ),
    allow(
      'lambda:InvokeFunction',
      ['worker', 'feedback'].map((name) =>
        arn('lambda', `function:findly-production-gallery-email-${name}`),
      ),
    ),
    allow(
      [
        'sqs:SendMessage',
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:ChangeMessageVisibility',
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
      ],
      queues,
    ),
    allow('ses:GetEmailIdentity', arn('ses', 'identity/findly.barcelona')),
    // SES suppression APIs cannot be scoped to recipient ARNs. The harness
    // must use only the unique simulator destination in the private manifest.
    allow(
      [
        'ses:GetAccount',
        'ses:GetSuppressedDestination',
        'ses:PutSuppressedDestination',
        'ses:DeleteSuppressedDestination',
      ],
      '*',
      { StringEquals: { 'aws:RequestedRegion': region } },
    ),
    allow(
      ['logs:FilterLogEvents', 'logs:GetLogEvents', 'logs:DescribeLogStreams'],
      ['request', 'status', 'worker', 'feedback'].map((name) =>
        arn(
          'logs',
          `log-group:/aws/lambda/findly-production-gallery-email-${name}:*`,
        ),
      ),
    ),
    // The harness filters by both reviewed eventId and photoId, then discards
    // log bodies. This read only proves its synthetic upload has settled.
    allow(
      'logs:FilterLogEvents',
      arn('logs', 'log-group:/aws/lambda/findly-production-photo-matcher:*'),
    ),
  ];
  // A stale role cannot mutate data after its reviewed manifest expires.
  const policy = {
    Version: '2012-10-17',
    Statement: statements.map((statement) => ({
      ...statement,
      Condition: {
        ...statement.Condition,
        DateLessThan: { 'aws:CurrentTime': manifest.expiresAt },
      },
    })),
  };
  const trust = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Federated: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
        },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub':
              'repo:upc-malvaviscos/findly:environment:production',
          },
          DateLessThan: { 'aws:CurrentTime': manifest.expiresAt },
        },
      },
    ],
  };
  assert(statements.length === 11);
  return { trust, policy };
}
