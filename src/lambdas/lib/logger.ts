import { randomUUID } from 'node:crypto';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * Metadata that may reach CloudWatch Logs (spec 12: log metadata only). The
 * list is closed on purpose: names, emails, gallery tokens, registration IDs,
 * face IDs and free-text error messages have no field here, so they cannot be
 * logged by accident, and `emitLog` also drops any other key at runtime.
 */
export type LogFields = {
  eventId?: string;
  photoId?: string;
  statusCode?: number;
  durationMs?: number;
  errorName?: string;
  expiredEvents?: number;
  purgedEvents?: number;
  matchesDeleted?: number;
  faceDeleted?: boolean;
  photoCount?: number;
  recordCount?: number;
  failedCount?: number;
};

/** The parts of the Lambda context and API Gateway request we correlate on. */
export type LambdaContextLike = { awsRequestId?: string };
export type RequestIds = {
  requestId?: string | null | undefined;
  awsRequestId?: string | null | undefined;
};

export type RequestLog = {
  readonly correlationId: string;
  /** Adds metadata to the summary line written when the request finishes. */
  annotate(fields: LogFields): void;
  info(event: string, fields?: LogFields): void;
};

const ALLOWED_FIELDS = [
  'eventId',
  'photoId',
  'statusCode',
  'durationMs',
  'errorName',
  'expiredEvents',
  'purgedEvents',
  'matchesDeleted',
  'faceDeleted',
  'photoCount',
  'recordCount',
  'failedCount',
] as const satisfies readonly (keyof LogFields)[];

// Identifiers and error names only ever contain these characters; anything
// else (an "@", spaces, a path) is not an identifier and is not logged.
const SAFE_TEXT = /^[A-Za-z0-9_.:-]{1,128}$/;
// API Gateway request IDs are base64-like ("Xk3sLg3PjoEEJOw="); Lambda request
// IDs and SQS message IDs are UUIDs.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_.:=+/-]{1,128}$/;
const REDACTED = '[redacted]';

function sanitize(value: string | number | boolean): unknown {
  if (typeof value === 'string')
    return SAFE_TEXT.test(value) ? value : REDACTED;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

/** First usable request identifier, or a fresh UUID when none is present. */
export function resolveCorrelationId(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates)
    if (candidate && SAFE_CORRELATION_ID.test(candidate)) return candidate;
  return randomUUID();
}

/**
 * The error class name only. `Error.message` from the AWS SDK can embed ARNs,
 * bucket keys or request data, so it is deliberately never logged.
 */
export function errorNameOf(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? error.name
      : undefined;
  return typeof name === 'string' && SAFE_TEXT.test(name)
    ? name
    : 'UnknownError';
}

export function emitLog(
  level: LogLevel,
  event: string,
  correlationId: string,
  fields: LogFields = {},
): void {
  const record: Record<string, unknown> = { level, event, correlationId };
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value !== undefined) record[key] = sanitize(value);
  }
  const line = JSON.stringify(record);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

function levelForStatus(statusCode: number): LogLevel {
  if (statusCode >= 500) return 'ERROR';
  if (statusCode >= 400) return 'WARN';
  return 'INFO';
}

/**
 * Runs an HTTP handler and writes exactly one summary line for it (status,
 * duration and any annotated metadata), or an ERROR line before rethrowing if
 * it throws. The same correlation ID is what handlers return to the client as
 * `requestId`, so a support report can be traced to its log lines.
 */
export async function withRequestLog<Result extends { statusCode: number }>(
  event: string,
  ids: RequestIds,
  work: (request: RequestLog) => Promise<Result>,
): Promise<Result> {
  const correlationId = resolveCorrelationId(ids.requestId, ids.awsRequestId);
  const startedAt = Date.now();
  const collected: LogFields = {};
  const request: RequestLog = {
    correlationId,
    annotate: (fields) => {
      Object.assign(collected, fields);
    },
    info: (name, fields) => emitLog('INFO', name, correlationId, fields),
  };
  try {
    const result = await work(request);
    emitLog(levelForStatus(result.statusCode), event, correlationId, {
      ...collected,
      statusCode: result.statusCode,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (caught) {
    emitLog('ERROR', `${event}_failed`, correlationId, {
      ...collected,
      errorName: errorNameOf(caught),
      durationMs: Date.now() - startedAt,
    });
    throw caught;
  }
}
