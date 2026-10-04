import * as sts from '@aws-sdk/client-sts';
import * as cognito from '@aws-sdk/client-cognito-identity-provider';
import * as logs from '@aws-sdk/client-cloudwatch-logs';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as s3 from '@aws-sdk/client-s3';
import * as sqs from '@aws-sdk/client-sqs';
import * as ses from '@aws-sdk/client-sesv2';
import * as rekognition from '@aws-sdk/client-rekognition';

const services = {
  sts: [
    sts,
    'STSClient',
    ['get-caller-identity', 'assume-role-with-web-identity'],
  ],
  'cognito-idp': [
    cognito,
    'CognitoIdentityProviderClient',
    [
      'describe-user-pool',
      'describe-user-pool-client',
      'admin-create-user',
      'admin-set-user-password',
      'initiate-auth',
      'admin-delete-user',
    ],
  ],
  logs: [logs, 'CloudWatchLogsClient', ['filter-log-events']],
  dynamodb: [
    dynamodb,
    'DynamoDBClient',
    ['put-item', 'get-item', 'query', 'delete-item', 'update-item'],
  ],
  s3api: [
    s3,
    'S3Client',
    ['get-bucket-versioning', 'delete-object', 'head-object'],
  ],
  sqs: [
    sqs,
    'SQSClient',
    [
      'get-queue-url',
      'get-queue-attributes',
      'receive-message',
      'change-message-visibility',
      'delete-message',
      'send-message',
    ],
  ],
  sesv2: [
    ses,
    'SESv2Client',
    [
      'get-account',
      'get-email-identity',
      'get-suppressed-destination',
      'put-suppressed-destination',
      'delete-suppressed-destination',
    ],
  ],
  rekognition: [
    rekognition,
    'RekognitionClient',
    ['create-collection', 'delete-collection', 'describe-collection'],
  ],
};

export function acceptanceAwsCommand(service, action) {
  const entry = services[service];
  if (!entry || !entry[2].includes(action))
    throw new Error('Unreviewed acceptance AWS operation');
  const name = `${action
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')}Command`;
  const Constructor = entry[0][name];
  if (!Constructor) throw new Error('Acceptance SDK command unavailable');
  return Constructor;
}

export function createAcceptanceAws(credentials) {
  const clients = new Map();
  return async (service, action, input = {}) => {
    const Command = acceptanceAwsCommand(service, action);
    if (!clients.has(service)) {
      const [sdk, clientName] = services[service];
      clients.set(
        service,
        new sdk[clientName]({
          region: 'eu-west-1',
          credentials,
          maxAttempts: 2,
        }),
      );
    }
    try {
      return await clients
        .get(service)
        .send(new Command(input), { abortSignal: AbortSignal.timeout(60000) });
    } catch (cause) {
      const error = new Error(
        `Acceptance AWS operation failed: ${service}:${action}`,
      );
      // Only the category is retained; request/response bodies and credentials never escape.
      error.code = /^[A-Za-z0-9]+$/.test(cause.name ?? '')
        ? cause.name
        : 'AWS_OPERATION_FAILED';
      throw error;
    }
  };
}
