import { z } from 'zod';

/**
 * Client-reported enrollment failures (ADR-018). The payload is two closed
 * enums on purpose: no event, registration, token, URL or browser data can
 * reach the telemetry endpoint, so its logs and metric carry no identifiers.
 */
export const ENROLLMENT_ERROR_STAGES = [
  'registration',
  'upload',
  'polling',
] as const;

export const CLIENT_ENROLLMENT_ERROR_CODES = [
  'BACKEND_NOT_CONFIGURED',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'UNKNOWN_STATUS',
  'INVALID_REQUEST',
  'EVENT_NOT_FOUND',
  'EVENT_EXPIRED',
  'REGISTRATION_NOT_FOUND',
  'REGISTRATION_EXPIRED',
  'SESSION_EXPIRED',
  'UPLOAD_FAILED',
  'UPLOAD_TIMEOUT',
  'UPLOAD_ABORTED',
  'UPLOAD_HTTP_4XX',
  'UPLOAD_HTTP_5XX',
  'HTTP_4XX',
  'HTTP_5XX',
  'UNKNOWN',
] as const;

export type EnrollmentErrorStage = (typeof ENROLLMENT_ERROR_STAGES)[number];
export type ClientEnrollmentErrorCode =
  (typeof CLIENT_ENROLLMENT_ERROR_CODES)[number];

export const clientEnrollmentErrorSchema = z
  .object({
    stage: z.enum(ENROLLMENT_ERROR_STAGES),
    code: z.enum(CLIENT_ENROLLMENT_ERROR_CODES),
  })
  .strict();

export type ClientEnrollmentError = z.infer<typeof clientEnrollmentErrorSchema>;

export const CLIENT_ENROLLMENT_ERROR_PATH = '/telemetry/enrollment-errors';

const KNOWN_CODES: ReadonlySet<string> = new Set(CLIENT_ENROLLMENT_ERROR_CODES);

/**
 * Maps a thrown client error to the closed code list. HTTP statuses are
 * grouped by class so the code set (and the metric dimension space) stays
 * fixed; anything unrecognised, including free text, becomes UNKNOWN.
 */
export function toClientEnrollmentErrorCode(
  error: unknown,
): ClientEnrollmentErrorCode {
  const message = error instanceof Error ? error.message : '';
  if (KNOWN_CODES.has(message)) return message as ClientEnrollmentErrorCode;
  const upload = /^UPLOAD_FAILED_([45])\d\d$/.exec(message);
  if (upload) return upload[1] === '4' ? 'UPLOAD_HTTP_4XX' : 'UPLOAD_HTTP_5XX';
  const http = /^HTTP_([45])\d\d$/.exec(message);
  if (http) return http[1] === '4' ? 'HTTP_4XX' : 'HTTP_5XX';
  return 'UNKNOWN';
}
