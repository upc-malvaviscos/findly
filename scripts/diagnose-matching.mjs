import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fields = [
  'level',
  'event',
  'errorName',
  'step',
  'statusCode',
  'photoCount',
  'recordCount',
  'failedCount',
];
const safeText = /^[A-Za-z0-9_.:-]{1,128}$/;

export function sanitizeMatchingLogs(events) {
  return events.flatMap((entry) => {
    const message = typeof entry.message === 'string' ? entry.message : '';
    const start = message.indexOf('{');
    if (start < 0) return [];
    try {
      const record = JSON.parse(message.slice(start));
      if (
        record === null ||
        typeof record !== 'object' ||
        Array.isArray(record)
      )
        return [];
      const selected = {};
      for (const key of fields) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value))
          selected[key] = value;
        else if (typeof value === 'string' && safeText.test(value))
          selected[key] = value;
      }
      if (!Object.keys(selected).length) return [];
      if (Number.isFinite(entry.timestamp))
        selected.timestamp = entry.timestamp;
      return [selected];
    } catch {
      return [];
    }
  });
}

function run() {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      !['--environment', '--hours', '--event-id'].includes(key) ||
      options[key] !== undefined ||
      !args[index + 1]
    )
      throw new Error('Invalid arguments');
    options[key] = args[index + 1];
  }
  const environment = options['--environment'];
  const hours = Number(options['--hours'] ?? 3);
  const eventId = options['--event-id'];
  const account = process.env.FINDLY_AWS_ACCOUNT_ID;
  if (
    !['production', 'demo', 'sandbox'].includes(environment) ||
    !/^\d{12}$/.test(account ?? '') ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 24 ||
    (eventId && !/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
  )
    throw new Error('Invalid configuration');
  const aws = (...command) =>
    JSON.parse(
      execFileSync(
        'aws',
        [
          ...command,
          '--region',
          'eu-west-1',
          '--output',
          'json',
          '--no-cli-pager',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
    );
  if (aws('sts', 'get-caller-identity').Account !== account)
    throw new Error('Unexpected account');
  const start = Date.now() - hours * 3600000;
  const groups = ['selfie-indexer', 'photo-matcher', 'gallery-reader'].map(
    (component) => {
      const command = [
        'logs',
        'filter-log-events',
        '--log-group-name',
        `/aws/lambda/findly-${environment}-${component}`,
        '--start-time',
        String(start),
        '--limit',
        '200',
        '--no-paginate',
      ];
      if (eventId)
        command.push('--filter-pattern', `{ $.eventId = "${eventId}" }`);
      const response = aws(...command);
      return {
        component,
        incomplete: Boolean(response.nextToken),
        events: sanitizeMatchingLogs(response.events ?? []),
      };
    },
  );
  console.log(
    JSON.stringify(
      {
        environment,
        region: 'eu-west-1',
        windowStart: new Date(start).toISOString(),
        groups,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    run();
  } catch {
    console.error(
      'Diagnostic incomplete. Check arguments, account, temporary session and read permissions. No AWS resources were modified; raw errors and private payloads are not printed.',
    );
    process.exitCode = 1;
  }
}
