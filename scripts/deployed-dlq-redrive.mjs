import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

// Use the installed CLI to avoid adding an SQS SDK dependency for a CI probe.
function sqs(command, args) {
  let output;
  try {
    output = execFileSync(
      'aws',
      ['sqs', command, ...args, '--output', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    // Node's original exec error includes argv and stderr, including receipts.
    throw new Error(`AWS SQS ${command} failed; request arguments suppressed.`);
  }
  return output.trim() ? JSON.parse(output) : {};
}
const source = process.env.EPHEMERAL_PHOTOS_QUEUE_URL;
const dlq = process.env.EPHEMERAL_PHOTOS_DLQ_URL;
const bucket = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
const prefix = process.env.EPHEMERAL_RESOURCE_PREFIX;
assert(
  source && dlq && bucket && prefix,
  'Source/DLQ URLs, uploads bucket and ephemeral resource prefix are required.',
);
assert.match(
  prefix,
  /^findly-pr-[0-9]+$/,
  'The redrive probe must target an isolated PR stack.',
);
for (const url of [source, dlq]) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert(
    parsed.pathname.split('/').at(-1)?.startsWith(`${prefix}-`),
    'Queue does not belong to this PR stack.',
  );
}
const attributes = sqs('get-queue-attributes', [
  '--queue-url',
  source,
  '--attribute-names',
  'RedrivePolicy',
  'VisibilityTimeout',
]).Attributes;
const redrive = JSON.parse(attributes.RedrivePolicy);
assert.equal(
  Number(redrive.maxReceiveCount),
  3,
  'Expect three failed receives, not three additional retries.',
);
assert.equal(
  redrive.deadLetterTargetArn.split(':').at(-1),
  new URL(dlq).pathname.split('/').at(-1),
);
const poisonId = randomUUID();
// A well-formed S3 photo record points at a deliberately nonexistent collection
// and object. Unlike invalid JSON (which is ignored), every Lambda attempt fails.
const body = JSON.stringify({
  Records: [
    {
      eventName: 'ObjectCreated:Put',
      s3: {
        bucket: { name: bucket },
        object: {
          key: `events/evt-poison-${poisonId}/photos/photo-${poisonId}.photo.jpg`,
        },
      },
    },
  ],
});
const sent = sqs('send-message', [
  '--queue-url',
  source,
  '--message-body',
  body,
]);
assert.equal(typeof sent.MessageId, 'string');
const maximumWaitMs = Math.min(
  1800000,
  Math.max(60000, (Number(attributes.VisibilityTimeout) * 4 + 120) * 1000),
);
const startedAt = Date.now();
const deadline = startedAt + maximumWaitMs;
let nextProgressAt = startedAt + 30000;
console.log(
  `DLQ redrive: waiting for three failed source receives and delivery to the isolated DLQ (limit: ${Math.floor(maximumWaitMs / 1000)}s).`,
);
let received = false;
while (Date.now() < deadline) {
  const result = sqs('receive-message', [
    '--queue-url',
    dlq,
    '--max-number-of-messages',
    '10',
    '--wait-time-seconds',
    '10',
    '--visibility-timeout',
    '10',
    '--message-system-attribute-names',
    'ApproximateReceiveCount',
  ]);
  for (const message of result.Messages ?? []) {
    if (message.MessageId !== sent.MessageId || message.Body !== body) continue;
    // Reaching the configured DLQ proves source redrive. DLQ receive count is
    // not source attempt count, so do not assert that it equals three.
    if (process.env.EPHEMERAL_KEEP_POISON_IN_DLQ === '1') {
      // Let the real SQS metric trigger the alarm. The stack destroy is still
      // mandatory; do not delete the poison before the alarm/SNS probe.
      sqs('change-message-visibility', [
        '--queue-url',
        dlq,
        '--receipt-handle',
        message.ReceiptHandle,
        '--visibility-timeout',
        '0',
      ]);
    } else {
      sqs('delete-message', [
        '--queue-url',
        dlq,
        '--receipt-handle',
        message.ReceiptHandle,
      ]);
    }
    received = true;
  }
  if (received) break;
  if (Date.now() >= nextProgressAt) {
    console.log(
      `DLQ redrive progress: poison message has not reached the DLQ; ${Math.floor((Date.now() - startedAt) / 1000)}s elapsed.`,
    );
    nextProgressAt = Date.now() + 30000;
  }
  await setTimeout(1000);
}
assert(
  received,
  'Poison message did not arrive in its DLQ before the bounded deadline.',
);
console.log(
  `AWS photo poison redrive passed: configured maxReceiveCount=3, original message reached its isolated DLQ; ${process.env.EPHEMERAL_KEEP_POISON_IN_DLQ === '1' ? 'retained for real alarm verification and mandatory stack destroy' : 'removed'}.`,
);
