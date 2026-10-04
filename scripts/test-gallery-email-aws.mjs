import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createAcceptanceAws } from './lib/email-acceptance-aws.mjs';
import {
  isOwnedAcceptanceMessage,
  runEmailAcceptance as runHarness,
} from './lib/email-acceptance-harness.mjs';

// A 160x160 uniform JPEG, generated once as a non-biometric test fixture.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCACgAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==',
  'base64',
);

function encode(value) {
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (value === null) return { NULL: true };
  if (Array.isArray(value)) return { L: value.map(encode) };
  return { M: attributes(value) };
}
function attributes(value) {
  return Object.fromEntries(
    Object.entries(value).map(([name, field]) => [name, encode(field)]),
  );
}
function decode(value) {
  if ('S' in value) return value.S;
  if ('N' in value) return Number(value.N);
  if ('BOOL' in value) return value.BOOL;
  if ('NULL' in value) return null;
  if ('L' in value) return value.L.map(decode);
  return Object.fromEntries(
    Object.entries(value.M).map(([name, field]) => [name, decode(field)]),
  );
}
function item(value) {
  return (
    value &&
    Object.fromEntries(
      Object.entries(value).map(([name, field]) => [name, decode(field)]),
    )
  );
}

export function createEmailAcceptanceAwsAdapter({
  manifest,
  outputs,
  jwt,
  aws,
  fetch: request = globalThis.fetch,
  credentials,
}) {
  const value = (name) => outputs[name]?.value;
  const table = value('table_name');
  const bucket = value('uploads_bucket_name');
  const endpoint = value('api_endpoint').replace(/\/$/, '');
  const sdkCredentials = credentials ?? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
  assert(
    sdkCredentials.accessKeyId &&
      sdkCredentials.secretAccessKey &&
      sdkCredentials.sessionToken,
    'Temporary operator credentials required',
  );
  const s3 = new S3Client({
    region: manifest.region,
    credentials: sdkCredentials,
    maxAttempts: 1,
  });
  const lambda = new LambdaClient({
    region: manifest.region,
    credentials: sdkCredentials,
    maxAttempts: 1,
  });
  const privateAws = aws ?? createAcceptanceAws(sdkCredentials);
  const call = (service, command, input) =>
    Promise.resolve(privateAws(service, command, input));
  const queueUrls = {};
  const queue = (suffix) => `findly-production-gallery-email${suffix}`;
  const invoke = async (suffix, payload) => {
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: `findly-production-gallery-email-${suffix}`,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
      { abortSignal: AbortSignal.timeout(90000) },
    );
    if (result.FunctionError)
      throw new Error('Deployed acceptance worker failed');
  };
  const absent = async (task, codes) => {
    try {
      await task();
      return true;
    } catch (error) {
      if (codes.includes(error.code ?? error.name)) return false;
      throw new Error('Private AWS resource lookup failed');
    }
  };
  return {
    async preflight() {
      const fixture = manifest.fixtures.find((item) => item.scenario === 'api');
      assert(fixture, 'API authorization fixture required');
      for (const [method, path, body] of [
        ['GET', '/admin/events'],
        [
          'POST',
          `/admin/events/${fixture.eventId}/gallery-emails`,
          { operationId: fixture.operationId },
        ],
      ]) {
        const response = await request(`${endpoint}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body && { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });
        assert.equal(
          response.status,
          401,
          'Private API must reject missing organizer authentication',
        );
      }
      const caller = await call('sts', 'get-caller-identity', {});
      assert.equal(caller.Account, manifest.account);
      assert(
        caller.Arn.startsWith(
          `arn:aws:sts::${manifest.account}:assumed-role/findly-production-email-acceptance/`,
        ),
        'Use the approved operator role, never root',
      );
      const ses = await call('sesv2', 'get-account', {});
      assert.equal(
        ses.ProductionAccessEnabled,
        true,
        'SES approval is pending',
      );
      assert.equal(ses.SendingEnabled, true, 'SES sending is disabled');
      const identity = await call('sesv2', 'get-email-identity', {
        EmailIdentity: 'findly.barcelona',
      });
      assert.equal(
        identity.VerifiedForSendingStatus,
        true,
        'SES identity is pending',
      );
      assert.equal(
        identity.DkimAttributes?.Status,
        'SUCCESS',
        'DKIM is pending',
      );
      assert.equal(
        identity.MailFromAttributes?.MailFromDomainStatus,
        'SUCCESS',
        'MAIL FROM is pending',
      );
      const versioning = await call('s3api', 'get-bucket-versioning', {
        Bucket: bucket,
      });
      assert(
        !versioning.Status,
        'Versioned fixture cleanup needs a separately reviewed design',
      );
      for (const suffix of [
        '.fifo',
        '-dlq.fifo',
        '-feedback',
        '-feedback-dlq',
      ]) {
        const result = await call('sqs', 'get-queue-url', {
          QueueName: queue(suffix),
        });
        queueUrls[suffix] = result.QueueUrl;
        const state = await call('sqs', 'get-queue-attributes', {
          QueueUrl: result.QueueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        });
        assert.equal(
          Number(state.Attributes.ApproximateNumberOfMessages),
          0,
          'Acceptance requires idle mail queues',
        );
        assert.equal(
          Number(state.Attributes.ApproximateNumberOfMessagesNotVisible),
          0,
          'Acceptance requires no concurrent mail work',
        );
      }
    },
    async api(method, path, body, expected = method === 'POST' ? 202 : 200) {
      const result = await request(`${endpoint}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        ...(body && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      assert.equal(
        result.status,
        expected,
        'Deployed acceptance API returned an unexpected status',
      );
      return expected === 410 ? {} : result.json();
    },
    async erase(registrationId, capability) {
      const result = await request(
        `${endpoint}/registrations/${registrationId}`,
        {
          method: 'DELETE',
          headers: { 'X-Gallery-Token': capability },
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        },
      );
      // 404 means this capability was not found/matched, not that every
      // worker-minted TOKEN# was revoked. Keep inverse references for retry.
      assert.equal(result.status, 204, 'Synthetic erasure failed');
    },
    async put(row) {
      await call('dynamodb', 'put-item', {
        TableName: table,
        Item: attributes(row),
        ConditionExpression: 'attribute_not_exists(PK)',
      });
    },
    async get(key) {
      return item(
        (
          await call('dynamodb', 'get-item', {
            TableName: table,
            Key: attributes(key),
            ConsistentRead: true,
          })
        ).Item,
      );
    },
    async query(pk) {
      const rows = [];
      let cursor;
      do {
        const result = await call('dynamodb', 'query', {
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': { S: pk } },
          ConsistentRead: true,
          ...(cursor && { ExclusiveStartKey: cursor }),
        });
        rows.push(...(result.Items ?? []).map(item));
        cursor = result.LastEvaluatedKey;
      } while (cursor);
      return rows;
    },
    async delete(key) {
      await call('dynamodb', 'delete-item', {
        TableName: table,
        Key: attributes(key),
      });
    },
    async revokeEvent(eventId) {
      await call('dynamodb', 'update-item', {
        TableName: table,
        Key: attributes({ PK: `EVENT#${eventId}`, SK: 'METADATA' }),
        UpdateExpression: 'SET erasureRequestedAt = :now',
        ExpressionAttributeValues: { ':now': { S: new Date().toISOString() } },
        ConditionExpression: 'attribute_exists(PK)',
      });
    },
    async removeCursor(eventId, operationId) {
      await call('dynamodb', 'update-item', {
        TableName: table,
        Key: attributes({ PK: `EVENT#${eventId}`, SK: `EMAIL#${operationId}` }),
        UpdateExpression: 'REMOVE #cursor',
        ExpressionAttributeNames: { '#cursor': 'cursor' },
        ConditionExpression: 'attribute_exists(PK)',
      });
    },
    async createCollection(collectionId) {
      await call('rekognition', 'create-collection', {
        CollectionId: collectionId,
        Tags: {
          Project: 'findly',
          Environment: 'production',
          ManagedBy: 'Terraform',
          CostCenter: 'findly',
          DataClass: 'synthetic',
        },
      });
    },
    async deleteCollection(collectionId) {
      await call('rekognition', 'delete-collection', {
        CollectionId: collectionId,
      });
    },
    collectionExists(collectionId) {
      return absent(
        () =>
          call('rekognition', 'describe-collection', {
            CollectionId: collectionId,
          }),
        ['ResourceNotFoundException'],
      );
    },
    async uploadPhoto(key) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: jpeg,
          ContentType: 'image/jpeg',
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
    },
    async deletePhoto(key) {
      await call('s3api', 'delete-object', { Bucket: bucket, Key: key });
    },
    photoExists(key) {
      return absent(
        () => call('s3api', 'head-object', { Bucket: bucket, Key: key }),
        ['404', 'NotFound', 'NoSuchKey'],
      );
    },
    async photoProcessed(eventId, photoId) {
      const result = await call('logs', 'filter-log-events', {
        LogGroupName: '/aws/lambda/findly-production-photo-matcher',
        StartTime: Date.parse(manifest.createdAt) - 60000,
        FilterPattern: `{ $.event = "photo_processed" && $.eventId = "${eventId}" && $.photoId = "${photoId}" }`,
        Limit: 1,
      });
      // Never return or print log bodies, including messages from other events.
      return (result.events ?? []).length > 0;
    },
    async receiveDeadLetters() {
      return (
        (
          await call('sqs', 'receive-message', {
            QueueUrl: queueUrls['-dlq.fifo'],
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 1,
            VisibilityTimeout: 30,
          })
        ).Messages ?? []
      );
    },
    async releaseDeadLetter(receipt) {
      await call('sqs', 'change-message-visibility', {
        QueueUrl: queueUrls['-dlq.fifo'],
        ReceiptHandle: receipt,
        VisibilityTimeout: 0,
      });
    },
    async deleteDeadLetter(receipt) {
      await call('sqs', 'delete-message', {
        QueueUrl: queueUrls['-dlq.fifo'],
        ReceiptHandle: receipt,
      });
    },
    async sendWork(body, deduplication) {
      await call('sqs', 'send-message', {
        QueueUrl: queueUrls['.fifo'],
        MessageBody: body,
        MessageGroupId: 'gallery-email',
        MessageDeduplicationId: deduplication,
      });
    },
    invokeWorker(payload) {
      return invoke('worker', payload);
    },
    invokeFeedback(payload) {
      return invoke('feedback', payload);
    },
    suppressed(address) {
      return absent(
        () =>
          call('sesv2', 'get-suppressed-destination', {
            EmailAddress: address,
          }),
        ['NotFoundException'],
      );
    },
    async addSuppression(address) {
      assert.equal(address, manifest.suppressionAddress);
      await call('sesv2', 'put-suppressed-destination', {
        EmailAddress: address,
        Reason: 'BOUNCE',
      });
    },
    async removeSuppression(address) {
      assert.equal(address, manifest.suppressionAddress);
      await call('sesv2', 'delete-suppressed-destination', {
        EmailAddress: address,
      });
    },
    async cleanupQueues(fixtures, budgetMs = 420000) {
      // Exact receipts only. Allow a worker's existing visibility lease (360s)
      // to expire, never purge/redrive queues, and preserve foreign messages.
      const deadline = Date.now() + Math.min(budgetMs, 420000);
      const cleanupCall = (...args) => {
        assert(deadline - Date.now() > 60000, 'Queue cleanup budget exhausted');
        return call(...args);
      };
      let emptyPasses = 0;
      while (Date.now() < deadline) {
        let pending = false;
        for (const QueueUrl of Object.values(queueUrls)) {
          const received = await cleanupCall('sqs', 'receive-message', {
            QueueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 1,
            VisibilityTimeout: 30,
          });
          for (const message of received.Messages ?? []) {
            if (!isOwnedAcceptanceMessage(message.Body, fixtures)) {
              await cleanupCall('sqs', 'change-message-visibility', {
                QueueUrl,
                ReceiptHandle: message.ReceiptHandle,
                VisibilityTimeout: 0,
              });
              throw new Error('Foreign queue message preserved');
            }
            await cleanupCall('sqs', 'delete-message', {
              QueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            });
          }
          const state = await cleanupCall('sqs', 'get-queue-attributes', {
            QueueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateNumberOfMessagesDelayed',
            ],
          });
          pending ||= Object.values(state.Attributes ?? {}).some(
            (count) => Number(count) !== 0,
          );
        }
        emptyPasses = pending ? 0 : emptyPasses + 1;
        if (emptyPasses === 2) return;
        await delay(5000);
      }
      throw new Error('Acceptance queue cleanup remains pending');
    },
  };
}

export async function runEmailAcceptance(options) {
  return runHarness({
    ...options,
    adapter: options.adapter ?? createEmailAcceptanceAwsAdapter(options),
    wait: options.wait ?? delay,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const manifest = JSON.parse(
      readFileSync(process.env.FINDLY_ACCEPTANCE_MANIFEST_FILE, 'utf8'),
    );
    const outputs = JSON.parse(
      readFileSync(process.env.FINDLY_ACCEPTANCE_OUTPUTS_FILE, 'utf8'),
    );
    const result = await runEmailAcceptance({
      manifest,
      outputs,
      jwt: process.env.FINDLY_ACCEPTANCE_JWT,
      recipients: JSON.parse(process.env.FINDLY_ACCEPTANCE_RECIPIENTS ?? '[]'),
      phase: process.env.FINDLY_ACCEPTANCE_PHASE ?? 'synthetic',
    });
    console.log(JSON.stringify(result));
  } catch {
    // No assertion diffs, request URLs, response bodies or credentials escape.
    throw new Error(
      'Gallery email AWS acceptance failed; inspect the private operator report and verify synthetic cleanup. Production infrastructure was preserved.',
    );
  }
}
