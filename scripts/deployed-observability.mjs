import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

function aws(service, command, args) {
  try {
    const output = execFileSync(
      'aws',
      [service, command, ...args, '--output', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return output.trim() ? JSON.parse(output) : {};
  } catch {
    // Original errors may include argv, log messages or SQS receipt handles.
    throw new Error(
      `AWS ${service} ${command} failed; request arguments suppressed.`,
    );
  }
}
const prefix = process.env.EPHEMERAL_RESOURCE_PREFIX;
const alarmName = process.env.PHOTOS_DLQ_ALARM_NAME;
const alertQueue = process.env.EPHEMERAL_ALERT_QUEUE_URL;
const dlq = process.env.EPHEMERAL_PHOTOS_DLQ_URL;
const functions = JSON.parse(
  process.env.EPHEMERAL_LAMBDA_FUNCTION_NAMES ?? 'null',
);
assert(
  prefix &&
    alarmName &&
    alertQueue &&
    dlq &&
    Array.isArray(functions) &&
    functions.length > 0,
  'PR prefix, DLQ URL/alarm, SNS alert queue and JSON Lambda names are required.',
);
assert.match(prefix, /^findly-pr-[0-9]+$/);
assert(
  alarmName.startsWith(`${prefix}-`),
  'Alarm is outside the isolated PR stack.',
);
assert(
  new URL(alertQueue).pathname.split('/').at(-1)?.startsWith(`${prefix}-`),
  'Alert queue is outside the isolated PR stack.',
);
assert(
  new URL(dlq).pathname.split('/').at(-1)?.startsWith(`${prefix}-`),
  'DLQ is outside the isolated PR stack.',
);
for (const name of functions)
  assert(
    typeof name === 'string' && name.startsWith(`${prefix}-`),
    'Lambda is outside the isolated PR stack.',
  );
assert.equal(
  new Set(functions).size,
  functions.length,
  'Lambda names must be unique.',
);

const forbiddenKeys =
  /^(email|token|galleryToken|authorization|password|registrationId|faceId|faceIds|embedding|embeddings|image|imageBytes|selfie|selfieKey|s3Key)$/i;
function checkNoSensitiveFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !forbiddenKeys.test(key),
      'An application log contains a prohibited sensitive field.',
    );
    if (typeof child === 'string') {
      assert(
        !/X-Amz-(Signature|Credential|Security-Token)=/i.test(child),
        'A log contains a presigned URL.',
      );
      assert(
        !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(child),
        'A log contains an email address.',
      );
    }
    checkNoSensitiveFields(child);
  }
}
function readApplicationLogs(logGroupName) {
  const records = [];
  let nextToken;
  do {
    const page = aws('logs', 'filter-log-events', [
      '--log-group-name',
      logGroupName,
      '--no-paginate',
      ...(nextToken ? ['--next-token', nextToken] : []),
    ]);
    for (const record of page.events ?? []) {
      const message = record.message.trim();
      if (
        /^(INIT_START|START RequestId:|END RequestId:|REPORT RequestId:)/.test(
          message,
        )
      )
        continue;
      const jsonStart = message.indexOf('{');
      assert(jsonStart >= 0, 'Application log is not JSON.');
      let entry;
      try {
        entry = JSON.parse(message.slice(jsonStart));
      } catch {
        assert.fail('Application log JSON cannot be parsed.');
      }
      if (typeof entry.type === 'string' && entry.type.startsWith('platform.'))
        continue;
      assert(
        typeof entry.correlationId === 'string' &&
          entry.correlationId.length > 0,
        'Application log is missing correlationId.',
      );
      assert(
        typeof entry.event === 'string' && typeof entry.level === 'string',
        'Application log is missing event/level.',
      );
      checkNoSensitiveFields(entry);
      records.push(entry);
    }
    if (page.nextToken === nextToken) break;
    nextToken = page.nextToken;
  } while (nextToken);
  return records;
}

const startedAt = Date.now();
const deadline = startedAt + 12 * 60 * 1000;
const pendingLogs = new Set(functions);
for (const name of functions) {
  const group = `/aws/lambda/${name}`;
  const groups = aws('logs', 'describe-log-groups', [
    '--log-group-name-prefix',
    group,
  ]).logGroups;
  assert.equal(
    groups.find((candidate) => candidate.logGroupName === group)
      ?.retentionInDays,
    14,
    'Lambda logs must retain exactly 14 days.',
  );
}
let alarmObserved = false;
let deliveryObserved = false;
let nextProgressAt = Date.now();
while (Date.now() < deadline) {
  for (const name of pendingLogs) {
    if (readApplicationLogs(`/aws/lambda/${name}`).length > 0)
      pendingLogs.delete(name);
  }
  const alarms = aws('cloudwatch', 'describe-alarms', [
    '--alarm-names',
    alarmName,
  ]).MetricAlarms;
  assert.equal(alarms.length, 1, 'Expected one deployed DLQ alarm.');
  const alarm = alarms[0];
  assert.equal(alarm.Namespace, 'AWS/SQS');
  assert.equal(alarm.MetricName, 'ApproximateNumberOfMessagesVisible');
  assert.equal(alarm.Threshold, 1);
  assert.equal(
    alarm.Dimensions?.find((dimension) => dimension.Name === 'QueueName')
      ?.Value,
    new URL(dlq).pathname.split('/').at(-1),
    'Alarm metric must target the tested DLQ.',
  );
  assert.equal(alarm.ActionsEnabled, true);
  assert(alarm.AlarmActions?.length > 0, 'Alarm has no SNS action.');
  alarmObserved ||= alarm.StateValue === 'ALARM';
  const result = aws('sqs', 'receive-message', [
    '--queue-url',
    alertQueue,
    '--max-number-of-messages',
    '10',
    '--wait-time-seconds',
    '10',
    '--visibility-timeout',
    '10',
  ]);
  for (const message of result.Messages ?? []) {
    let notification;
    try {
      const envelope = JSON.parse(message.Body);
      // SNS delivery must retain its envelope so the publisher/topic is checked.
      assert.equal(envelope.Type, 'Notification');
      assert(
        alarm.AlarmActions.includes(envelope.TopicArn),
        'Notification topic is not an action of the deployed alarm.',
      );
      notification = JSON.parse(envelope.Message);
    } catch {
      continue;
    }
    if (
      notification.AlarmName !== alarmName ||
      notification.NewStateValue !== 'ALARM'
    )
      continue;
    assert.equal(notification.Trigger?.Namespace, 'AWS/SQS');
    assert.equal(
      notification.Trigger?.MetricName,
      'ApproximateNumberOfMessagesVisible',
    );
    aws('sqs', 'delete-message', [
      '--queue-url',
      alertQueue,
      '--receipt-handle',
      message.ReceiptHandle,
    ]);
    deliveryObserved = true;
  }
  if (Date.now() >= nextProgressAt) {
    console.log(
      `Observability progress: ${pendingLogs.size} Lambda log groups pending; alarm observed=${alarmObserved}; SNS delivery observed=${deliveryObserved}; ${Math.floor((Date.now() - startedAt) / 1000)}s elapsed.`,
    );
    nextProgressAt = Date.now() + 30000;
  }
  if (alarmObserved && deliveryObserved && pendingLogs.size === 0) break;
  await setTimeout(1000);
}
assert.equal(
  pendingLogs.size,
  0,
  'One or more deployed Lambdas have no application log evidence; invoke every handler before the probe.',
);
assert(
  alarmObserved,
  'The real SQS DLQ metric did not put the deployed alarm into ALARM.',
);
assert(
  deliveryObserved,
  'No corresponding CloudWatch ALARM notification was delivered through SNS to its SQS subscriber.',
);
console.log(
  `AWS observability passed: ${functions.length} Lambda log groups retain 14 days, application JSON logs have correlationId without sensitive fields, real DLQ alarm and SNS→SQS delivery observed. No Budget alert was tested.`,
);
