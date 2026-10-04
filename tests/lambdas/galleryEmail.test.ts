import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GetSuppressedDestinationCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));
import { setTimeout as delay } from 'node:timers/promises';
import {
  requestGalleryEmail,
  getGalleryEmailStatus,
  processGalleryEmail,
  galleryEmailContent,
} from '../../src/lambdas/galleryEmail';

const db = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const sqs = mockClient(SQSClient);
const s3 = mockClient(S3Client);
const operationId = '00000000-0000-4000-8000-000000000001';
const nextId = '00000000-0000-4000-8000-000000000002';
const ttl = Math.floor(Date.now() / 1000) + 86400;
const request = {
  pathParameters: { eventId: 'demo' },
  body: JSON.stringify({ operationId }),
  requestContext: { authorizer: { jwt: { claims: { sub: 'organizer' } } } },
};
const message = (operation = operationId) => ({
  Records: [
    { body: JSON.stringify({ eventId: 'demo', operationId: operation }) },
  ],
});
let items: Map<string, Record<string, unknown>>;
let registrations: string[];
function opKey(operation = operationId) {
  return `EVENT#demo/EMAIL#${operation}`;
}
function operation(overrides: Record<string, unknown> = {}) {
  return {
    operationId,
    status: 'RUNNING',
    ttl,
    revision: 0,
    accepted: 0,
    skipped: 0,
    missingEmail: 0,
    failed: 0,
    uncertain: 0,
    bounced: 0,
    complained: 0,
    ...overrides,
  };
}
function reg(overrides: Record<string, unknown> = {}) {
  return {
    registrationId: 'reg',
    email: 'synthetic@example.com',
    consentTimestamp: 'synthetic-consent',
    status: 'ENROLLED',
    ttl,
    ...overrides,
  };
}
function error(name: string) {
  return Object.assign(new Error('synthetic sensitive detail'), { name });
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv(
    'FINDLY_EMAIL_QUEUE_URL',
    'https://sqs.synthetic.invalid/queue.fifo',
  );
  vi.stubEnv('FINDLY_GALLERY_ORIGIN', 'https://findly.barcelona');
  vi.stubEnv('FINDLY_EMAIL_FROM', 'info@findly.barcelona');
  vi.stubEnv('FINDLY_EMAIL_CONFIGURATION_SET', 'synthetic');
  db.reset();
  ses.reset();
  sqs.reset();
  s3.reset();
  vi.mocked(delay).mockResolvedValue(undefined);
  registrations = ['reg'];
  items = new Map<string, Record<string, unknown>>([
    [
      'EVENT#demo/METADATA',
      {
        name: 'Evento sintético',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        retentionDays: 1,
      },
    ],
    ['EVENT#demo/REG#reg', reg()],
    [
      'EVENT#demo/PHOTO#photo',
      { s3Key: 'events/demo/photos/photo.photo.jpg', ttl },
    ],
    [opKey(), operation()],
  ]);
  db.on(GetCommand).callsFake((input) => ({
    Item: items.get(`${input.Key.PK}/${input.Key.SK}`),
  }));
  db.on(PutCommand).callsFake((input) => {
    items.set(`${input.Item.PK}/${input.Item.SK}`, input.Item);
    return {};
  });
  db.on(QueryCommand).callsFake((input) => {
    if (input.ExpressionAttributeValues[':prefix'] === 'REG#') {
      const index = input.ExclusiveStartKey
        ? registrations.indexOf(String(input.ExclusiveStartKey.SK).slice(4)) + 1
        : 0;
      const registrationId = registrations[index];
      return {
        Items: registrationId ? [{ registrationId }] : [],
        ...(index + 1 < registrations.length
          ? {
              LastEvaluatedKey: {
                PK: 'EVENT#demo',
                SK: `REG#${registrationId}`,
              },
            }
          : {}),
      };
    }
    return { Items: [{ eventId: 'demo', photoId: 'photo', ttl }] };
  });
  db.on(TransactWriteCommand).callsFake((input) => {
    for (const action of input.TransactItems)
      if (action.Put)
        items.set(
          `${action.Put.Item.PK}/${action.Put.Item.SK}`,
          action.Put.Item,
        );
    return {};
  });
  db.on(UpdateCommand).callsFake((input) => {
    const key = `${input.Key.PK}/${input.Key.SK}`;
    const item = items.get(key);
    if (!item) throw error('ConditionalCheckFailedException');
    if (input.ExpressionAttributeValues[':state'])
      item.state = input.ExpressionAttributeValues[':state'];
    if (input.ExpressionAttributeValues[':retry'])
      item.state = input.ExpressionAttributeValues[':retry'];
    if (input.ExpressionAttributeValues[':status']) {
      item.status = input.ExpressionAttributeValues[':status'];
      item.revision = input.ExpressionAttributeValues[':next'];
      item.cursor = input.ExpressionAttributeValues[':cursor'];
      const counter = input.ExpressionAttributeNames?.['#count'];
      if (counter) item[counter] = Number(item[counter]) + 1;
    }
    return {};
  });
  ses.on(GetSuppressedDestinationCommand).rejects(error('NotFoundException'));
  ses.on(SendEmailCommand).resolves({ MessageId: 'synthetic-provider-id' });
  sqs.on(SendMessageCommand).resolves({});
  s3.on(HeadObjectCommand).resolves({});
});
describe('manual gallery email API', () => {
  it('rejects unauthenticated requests and status reads before accessing data', async () => {
    expect((await requestGalleryEmail({})).statusCode).toBe(401);
    expect((await getGalleryEmailStatus({})).statusCode).toBe(401);
    expect(db.calls()).toHaveLength(0);
  });
  it.each([
    'bad',
    '{}',
    JSON.stringify({ operationId: 'invalid' }),
    JSON.stringify({ operationId, email: 'synthetic@example.com' }),
  ])('rejects invalid request %s', async (body) => {
    expect((await requestGalleryEmail({ ...request, body })).statusCode).toBe(
      400,
    );
    expect(sqs.calls()).toHaveLength(0);
  });
  it('rejects missing event IDs and configuration', async () => {
    expect(
      (await requestGalleryEmail({ ...request, pathParameters: {} }))
        .statusCode,
    ).toBe(400);
    vi.stubEnv('FINDLY_EMAIL_QUEUE_URL', '');
    expect((await requestGalleryEmail(request)).statusCode).toBe(503);
  });
  it('rejects missing, closed, expired and erased events', async () => {
    const metadata = items.get('EVENT#demo/METADATA')!;
    items.delete('EVENT#demo/METADATA');
    expect((await requestGalleryEmail(request)).statusCode).toBe(404);
    for (const change of [
      { status: 'CLOSED' },
      { createdAt: '2000-01-01' },
      { erasureRequestedAt: 'now' },
    ]) {
      items.set('EVENT#demo/METADATA', { ...metadata, ...change });
      expect((await requestGalleryEmail(request)).statusCode).toBe(410);
    }
  });
  it('creates one durable operation for the same UUID and another for a new confirmation', async () => {
    items.delete(opKey());
    const first = await requestGalleryEmail(request);
    const retry = await requestGalleryEmail(request);
    expect(first.body).toBe(retry.body);
    expect(db.commandCalls(PutCommand)).toHaveLength(1);
    await requestGalleryEmail({
      ...request,
      body: JSON.stringify({ operationId: nextId }),
    });
    expect(db.commandCalls(PutCommand)).toHaveLength(2);
    expect(ses.calls()).toHaveLength(0);
  });
  it('recovers a queue failure on retry without replacing the operation', async () => {
    items.delete(opKey());
    sqs.on(SendMessageCommand).rejectsOnce(error('NetworkError')).resolves({});
    await expect(requestGalleryEmail(request)).rejects.toThrow();
    expect(items.has(opKey())).toBe(true);
    expect((await requestGalleryEmail(request)).statusCode).toBe(202);
    expect(db.commandCalls(PutCommand)).toHaveLength(1);
  });
  it('handles concurrent creation and surfaces unrelated persistence failures', async () => {
    let reads = 0;
    db.on(GetCommand).callsFake((input) => {
      if (input.Key.SK === `EMAIL#${operationId}`)
        return { Item: ++reads === 1 ? undefined : operation() };
      return { Item: items.get(`${input.Key.PK}/${input.Key.SK}`) };
    });
    db.on(PutCommand).rejects(error('ConditionalCheckFailedException'));
    expect((await requestGalleryEmail(request)).statusCode).toBe(202);
    reads = 0;
    db.on(PutCommand).rejects(error('AccessDenied'));
    await expect(requestGalleryEmail(request)).rejects.toThrow();
  });
  it('reports stalled operations without leaking checkpoint and resumes the same UUID', async () => {
    items.set(opKey(), operation({ updatedAt: Date.now() - 601000 }));
    const response = await getGalleryEmailStatus({
      ...request,
      pathParameters: { eventId: 'demo', operationId },
    });
    expect(JSON.parse(response.body).status).toBe('STALLED');
    expect((await requestGalleryEmail(request)).statusCode).toBe(202);
    expect(
      sqs.commandCalls(SendMessageCommand)[0]?.args[0].input.MessageBody,
    ).toContain(operationId);
    expect(db.commandCalls(PutCommand)).toHaveLength(0);
  });
  it('does not enqueue completed operations; returns only public progress', async () => {
    items.set(
      opKey(),
      operation({
        status: 'COMPLETED',
        cursor: { PK: 'EVENT#demo', SK: 'REG#reg' },
      }),
    );
    expect((await requestGalleryEmail(request)).statusCode).toBe(202);
    expect(sqs.calls()).toHaveLength(0);
    const status = await getGalleryEmailStatus({
      ...request,
      pathParameters: { eventId: 'demo', operationId },
    });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toMatch(
      /cursor|REG#|ttl|revision|synthetic@example/,
    );
    expect((await getGalleryEmailStatus(request)).statusCode).toBe(400);
    expect(
      (
        await getGalleryEmailStatus({
          ...request,
          pathParameters: { eventId: 'demo', operationId: nextId },
        })
      ).statusCode,
    ).toBe(404);
  });
});
describe('durable gallery email worker', () => {
  it('sends an individual message with HTTPS link, both bodies and no persisted token', async () => {
    await processGalleryEmail(message());
    const send = ses.commandCalls(SendEmailCommand)[0]!.args[0].input;
    expect(send.FromEmailAddress).toBe('info@findly.barcelona');
    expect(send.Destination).toEqual({
      ToAddresses: ['synthetic@example.com'],
    });
    expect(send.Content?.Simple?.Body?.Html?.Data).toContain(
      'https://findly.barcelona/gallery?token=',
    );
    const text = send.Content?.Simple?.Body?.Text?.Data ?? '';
    const token = text.match(/token=([A-Za-z0-9_-]+)/)![1];
    expect(token).toHaveLength(43);
    expect(JSON.stringify([...items.values()])).not.toContain(token);
    expect(items.get(opKey())).toMatchObject({
      status: 'COMPLETED',
      accepted: 1,
    });
    const transaction =
      db.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(transaction[1]?.ConditionCheck?.ConditionExpression).toContain(
      'attribute_not_exists(erasureRequestedAt)',
    );
    expect(transaction[4]?.Put?.Item?.ttl).toBeLessThanOrEqual(ttl);
    expect(transaction[5]?.Put?.Item).not.toHaveProperty('ttl');
  });
  it('retries an accepted recipient after a checkpoint crash without another send', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      if (
        input.Key.SK === `EMAIL#${operationId}` &&
        input.Key.PK === 'EVENT#demo'
      )
        throw error('NetworkError');
      items.get(`${input.Key.PK}/${input.Key.SK}`)!.state =
        input.ExpressionAttributeValues[':state'];
      return {};
    });
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
  });
  it('paginates registrations, skips terminal operations, and allows a distinct resend', async () => {
    registrations = ['reg', 'reg-two'];
    items.set('EVENT#demo/REG#reg-two', reg({ registrationId: 'reg-two' }));
    await processGalleryEmail(message());
    expect(sqs.calls()).toHaveLength(1);
    expect(items.get(opKey())?.status).toBe('RUNNING');
    await processGalleryEmail(message());
    await processGalleryEmail(message());
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(2);
    items.set(opKey(nextId), operation({ operationId: nextId }));
    await processGalleryEmail(message(nextId));
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(3);
    items.delete(opKey());
    await processGalleryEmail(message());
  });
  it.each([{ email: undefined }, { email: '' }, { email: 'invalid' }])(
    'counts legacy or invalid email without changing the existing gallery (%j)',
    async (change) => {
      items.set('EVENT#demo/REG#reg', reg(change));
      await processGalleryEmail(message());
      expect(items.get(opKey())?.missingEmail).toBe(1);
      expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
      expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
    },
  );
  it.each([
    { ttl: 1 },
    { status: 'FAILED' },
    { consentTimestamp: '' },
    { erasureRequestedAt: 'now' },
  ])('skips ineligible registration %j', async (change) => {
    items.set('EVENT#demo/REG#reg', reg(change));
    await processGalleryEmail(message());
    expect(items.get(opKey())?.skipped).toBe(1);
    expect(ses.calls()).toHaveLength(0);
  });
  it('skips removed registrations and erased events', async () => {
    items.delete('EVENT#demo/REG#reg');
    await processGalleryEmail(message());
    expect(ses.calls()).toHaveLength(0);
    items.set(opKey(), operation());
    items.set('EVENT#demo/REG#reg', reg());
    items.get('EVENT#demo/METADATA')!.erasureRequestedAt = 'now';
    await processGalleryEmail(message());
    expect(ses.calls()).toHaveLength(0);
  });
  it('requires a match from this event and an available, unexpired photo', async () => {
    db.on(QueryCommand).callsFake((input) =>
      input.ExpressionAttributeValues[':prefix'] === 'REG#'
        ? { Items: [{ registrationId: 'reg' }] }
        : {
            Items: [
              { eventId: 'another', photoId: 'photo' },
              { eventId: 'demo', photoId: 'gone', ttl },
            ],
          },
    );
    await processGalleryEmail(message());
    expect(ses.calls()).toHaveLength(0);
  });
  it.each([undefined, 'invalid', 1])(
    'skips matches with invalid or expired TTL %j',
    async (matchTtl) => {
      db.on(QueryCommand).callsFake((input) =>
        input.ExpressionAttributeValues[':prefix'] === 'REG#'
          ? { Items: [{ registrationId: 'reg' }] }
          : { Items: [{ eventId: 'demo', photoId: 'photo', ttl: matchTtl }] },
      );
      await processGalleryEmail(message());
      expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    },
  );
  it.each([
    { ttl: 1 },
    { erasureRequestedAt: 'now' },
    { s3Key: 'events/other/photos/photo.jpg' },
    { s3Key: undefined },
  ])('skips unavailable photo %j', async (change) => {
    items.set('EVENT#demo/PHOTO#photo', {
      ttl,
      s3Key: 'events/demo/photos/photo.photo.jpg',
      ...change,
    });
    await processGalleryEmail(message());
    expect(ses.calls()).toHaveLength(0);
  });
  it('paginates matches and skips missing S3 objects, but retries other storage errors', async () => {
    db.on(QueryCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues[':prefix'] === 'REG#')
        return { Items: [{ registrationId: 'reg' }] };
      return input.ExclusiveStartKey
        ? { Items: [{ eventId: 'demo', photoId: 'photo', ttl }] }
        : { Items: [], LastEvaluatedKey: { PK: 'REG#reg', SK: 'MATCH#first' } };
    });
    s3.on(HeadObjectCommand).rejects({ $metadata: { httpStatusCode: 404 } });
    await processGalleryEmail(message());
    expect(ses.calls()).toHaveLength(0);
    items.set(opKey(), operation());
    s3.on(HeadObjectCommand).rejects(error('AccessDenied'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
  });
  it('suppresses permanent bounce and complaint recipients and fails closed on suppression lookup errors', async () => {
    ses.on(GetSuppressedDestinationCommand).resolves({});
    await processGalleryEmail(message());
    expect(items.get(opKey())?.skipped).toBe(1);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    items.set(opKey(), operation());
    ses.on(GetSuppressedDestinationCommand).rejects(error('AccessDenied'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
  });
  it.each([
    'http://findly.barcelona',
    'https://user:pass@findly.barcelona',
    'https://findly.barcelona/path',
    'https://findly.barcelona?tracking=1',
    'https://findly.barcelona#x',
    '',
  ])('fails closed for unsafe origin %s', async (origin) => {
    vi.stubEnv('FINDLY_GALLERY_ORIGIN', origin);
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
  it('handles claim conflicts without sending and surfaces storage failure', async () => {
    db.on(TransactWriteCommand).rejects(error('TransactionCanceledException'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    db.on(TransactWriteCommand).rejects(error('AccessDenied'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
  });
  it('revalidates after claiming and after rate pacing; erasure prevents sending', async () => {
    vi.mocked(delay).mockImplementation(async () => {
      items.delete('EVENT#demo/REG#reg');
      items.delete(`REG#reg/EMAIL#${operationId}`);
    });
    await processGalleryEmail(message());
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect(items.has(`REG#reg/EMAIL#${operationId}`)).toBe(false);
  });
  it('does not send to a changed recipient after pacing', async () => {
    vi.mocked(delay).mockImplementation(async () => {
      items.get('EVENT#demo/REG#reg')!.email = 'changed@example.com';
    });
    await processGalleryEmail(message());
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
  it('records ambiguous results and never automatically resends a stale SENDING claim', async () => {
    ses.on(SendEmailCommand).rejects(error('TimeoutError'));
    await processGalleryEmail(message());
    expect(items.get(opKey())?.uncertain).toBe(1);
    items.set(opKey(), operation());
    items.set(`REG#reg/EMAIL#${operationId}`, { state: 'SENDING' });
    await processGalleryEmail(message());
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
    expect(items.get(opKey())?.uncertain).toBe(1);
  });
  it('records missing provider acceptance IDs as uncertain and explicit rejections as failed', async () => {
    ses.on(SendEmailCommand).resolves({});
    await processGalleryEmail(message());
    expect(items.get(opKey())?.uncertain).toBe(1);
    items.set(opKey(), operation());
    items.delete(`REG#reg/EMAIL#${operationId}`);
    ses.on(SendEmailCommand).rejects(error('MessageRejected'));
    await processGalleryEmail(message());
    expect(items.get(opKey())?.failed).toBe(1);
  });
  it('retries definite throttling without treating it as an accepted message', async () => {
    ses
      .on(SendEmailCommand)
      .rejectsOnce(error('TooManyRequestsException'))
      .resolves({ MessageId: 'synthetic' });
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    expect(items.get(`REG#reg/EMAIL#${operationId}`)?.state).toBe('RETRY');
    await processGalleryEmail(message());
    expect(items.get(opKey())?.accepted).toBe(1);
  });
  it('does not recreate erased recipient state on final persistence and retries unrelated failures', async () => {
    ses.on(SendEmailCommand).callsFake(() => {
      items.delete(`REG#reg/EMAIL#${operationId}`);
      return { MessageId: 'synthetic' };
    });
    await processGalleryEmail(message());
    expect(items.has(`REG#reg/EMAIL#${operationId}`)).toBe(false);
    items.set(opKey(), operation());
    db.on(UpdateCommand).rejects(error('AccessDenied'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
  });
  it('completes an empty event and rejects malformed queue work without exposing contents', async () => {
    registrations = [];
    await processGalleryEmail(message());
    expect(items.get(opKey())?.status).toBe('COMPLETED');
    await expect(
      processGalleryEmail({ Records: [{ body: 'sensitive malformed data' }] }),
    ).rejects.toThrow('GalleryEmailProcessingFailed');
  });
  it('escapes event names and link attributes in HTML', () => {
    const content = galleryEmailContent(
      '<script>&"\' malicious',
      'https://synthetic.invalid/?x="',
      'synthetic',
    );
    expect(content.Body.Html.Data).not.toContain('<script>');
    expect(content.Body.Html.Data).toContain('&lt;script&gt;&amp;&quot;&#39;');
    expect(content.Body.Text.Data).toContain('<script>');
  });
});

it('logs only closed outcomes and identifiers, never recipient email or gallery capability', async () => {
  const info = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await processGalleryEmail(message(), { awsRequestId: 'synthetic-request' });
    const output = JSON.stringify(info.mock.calls);
    expect(output).toContain('gallery_email_accepted');
    expect(output).not.toMatch(/synthetic@example|token=|reg|operationId/);
    items.set(opKey(), operation());
    items.delete(`REG#reg/EMAIL#${operationId}`);
    ses.on(GetSuppressedDestinationCommand).rejects(error('SensitiveError'));
    await expect(processGalleryEmail(message())).rejects.toThrow(
      'GalleryEmailProcessingFailed',
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain(
      'synthetic sensitive detail',
    );
  } finally {
    info.mockRestore();
    errors.mockRestore();
  }
});
