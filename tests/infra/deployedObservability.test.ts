import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const fixtureDirectory = mkdtempSync(
  join(tmpdir(), 'findly-observability-test-'),
);
const topic = 'arn:aws:sns:eu-west-1:000000000000:findly-pr-70-alerts';
const alarm = 'findly-pr-70-photos-dlq-has-messages';
const dlqName = 'findly-pr-70-photos-dlq';
// This CLI fixture tests fail-closed parsing/privacy gates only. It is not AWS
// evidence and never runs a real AWS command or emits real account identifiers.
//
// Windows-only limitation, root cause confirmed by isolated repro (not a PATH
// ordering issue): this fixture is a POSIX shebang script named `aws`, and
// Windows has no native way to execute that file at all, regardless of PATH
// contents. `scripts/deployed-observability.mjs` calls it via
// `execFileSync('aws', …)` with `shell: false`; on Windows, Node's spawn never
// does PATHEXT resolution for a bare command without `shell: true` (confirmed
// by mutating `process.env.PATH` directly before spawning — still ENOENT), and
// separately, Node hard-refuses to launch a `.cmd`/`.bat` file at all without
// `shell: true` (`EINVAL`, a deliberate Node security hardening). A `.cmd`
// variant of this fixture would therefore only work with `shell: true` added
// to the real `aws()` helper — but that helper also issues the real AWS calls
// in `provision-test-destroy`, where shell-metacharacter interpretation of
// ARNs/queue URLs would trade a local Windows convenience for a command
// injection surface on a path that runs with federated AWS credentials. Not
// worth it: this suite is skipped on Windows below instead. CI (Ubuntu) runs
// it unaffected, which is where it provides real coverage.
writeFileSync(
  join(fixtureDirectory, 'aws'),
  `#!${process.execPath}
const args = process.argv.slice(2);
const command = args[1];
const argument = (name) => args[args.indexOf(name) + 1];
const topic = ${JSON.stringify(topic)};
const alarm = ${JSON.stringify(alarm)};
let result;
if (command === 'describe-log-groups') {
  result = { logGroups: [{ logGroupName: argument('--log-group-name-prefix'), retentionInDays: Number(process.env.FINDLY_TEST_RETENTION ?? '14') }] };
} else if (command === 'filter-log-events') {
  result = { events: [{ message: process.env.FINDLY_TEST_LOG ?? JSON.stringify({ level: 'INFO', event: 'photo_batch_processed', correlationId: 'synthetic-correlation' }) }] };
} else if (command === 'describe-alarms') {
  result = { MetricAlarms: [{ Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible', Threshold: 1, ActionsEnabled: true, AlarmActions: [topic], StateValue: 'ALARM', Dimensions: [{ Name: 'QueueName', Value: ${JSON.stringify(dlqName)} }] }] };
} else if (command === 'receive-message') {
  result = { Messages: [{ ReceiptHandle: 'synthetic-receipt', Body: JSON.stringify({ Type: 'Notification', TopicArn: topic, Message: JSON.stringify({ AlarmName: alarm, NewStateValue: 'ALARM', Trigger: { Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible' } }) }) }] };
} else if (command === 'delete-message') { result = {}; }
else { throw new Error('Unexpected fixture command'); }
console.log(JSON.stringify(result));
`,
  { mode: 0o700 },
);
afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

function probe(overrides: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [resolve('scripts/deployed-observability.mjs')],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}${delimiter}${process.env.PATH ?? ''}`,
        EPHEMERAL_RESOURCE_PREFIX: 'findly-pr-70',
        PHOTOS_DLQ_ALARM_NAME: alarm,
        EPHEMERAL_ALERT_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/000000000000/findly-pr-70-alert-sink',
        EPHEMERAL_PHOTOS_DLQ_URL: `https://sqs.eu-west-1.amazonaws.com/000000000000/${dlqName}`,
        EPHEMERAL_LAMBDA_FUNCTION_NAMES: JSON.stringify([
          'findly-pr-70-photo-matcher',
        ]),
        ...overrides,
      },
    },
  );
}

describe.skipIf(process.platform === 'win32')(
  'deployed observability probe guardrails (CLI fixture)',
  () => {
    it('accepts complete JSON log, retention, alarm and SNS delivery evidence', () => {
      const result = probe();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No Budget alert was tested.');
    });

    it('rejects retention that differs from 14 days', () => {
      const result = probe({ FINDLY_TEST_RETENTION: '30' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('retain exactly 14 days');
    });

    it('rejects nested sensitive fields without echoing their value', () => {
      const privateValue = 'synthetic-private-marker';
      const result = probe({
        FINDLY_TEST_LOG: JSON.stringify({
          level: 'INFO',
          event: 'sample',
          correlationId: 'synthetic',
          details: { token: privateValue },
        }),
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('prohibited sensitive field');
      expect(result.stdout + result.stderr).not.toContain(privateValue);
    });

    it('rejects non-JSON application logs', () => {
      const result = probe({
        FINDLY_TEST_LOG: 'unstructured application output',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Application log is not JSON');
    });

    it('rejects shared environment resources before any AWS operation', () => {
      const result = probe({ EPHEMERAL_RESOURCE_PREFIX: 'findly-demo' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('findly-pr-');
    });
  },
);
