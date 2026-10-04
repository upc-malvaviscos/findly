import { apiClient, apiUrl } from './apiClient';
import {
  CLIENT_ENROLLMENT_ERROR_PATH,
  toClientEnrollmentErrorCode,
  type ClientEnrollmentError,
  type EnrollmentErrorStage,
} from '../shared/lib/enrollmentErrorTelemetry';
import { uploadFileToS3 } from './s3Uploader';
import type {
  Event,
  RegistrationRequest,
  RegistrationResponse,
  RegistrationStatus,
  RegistrationStatusResponse,
} from './types';

export { uploadFileToS3 };

const REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  'UPLOAD_PENDING',
  'PROCESSING',
  'ENROLLED',
  'FAILED',
];

function baseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!configured) throw new Error('BACKEND_NOT_CONFIGURED');
  return configured;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Only stable error codes leave this module: never response bodies, URLs or
// anything that could carry PII or S3 keys.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = apiUrl(baseUrl(), path);
  try {
    return await apiClient<T>(url, options);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('INVALID_RESPONSE');
    if (error instanceof TypeError) throw new Error('NETWORK_ERROR');
    throw error;
  }
}

export async function getEvents(): Promise<Event[]> {
  const payload = await request<unknown>('/events');
  if (!isRecord(payload) || !Array.isArray(payload.events))
    throw new Error('INVALID_RESPONSE');
  return payload.events.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.eventId !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.date !== 'string'
    )
      throw new Error('INVALID_RESPONSE');
    return {
      eventId: item.eventId,
      name: item.name,
      date: item.date,
      location: '',
      description: '',
    };
  });
}

export async function getEvent(eventId: string): Promise<Event | null> {
  let payload: unknown;
  try {
    payload = await request<unknown>(`/events/${encodeURIComponent(eventId)}`);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'HTTP_404' || error.message === 'EVENT_NOT_FOUND')
    )
      return null;
    throw error;
  }
  if (
    !isRecord(payload) ||
    typeof payload.eventId !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.date !== 'string'
  )
    throw new Error('INVALID_RESPONSE');
  return {
    eventId: payload.eventId,
    name: payload.name,
    date: payload.date,
    location: typeof payload.location === 'string' ? payload.location : '',
    description:
      typeof payload.description === 'string' ? payload.description : '',
  };
}

export async function createRegistration(
  eventId: string,
  registration: RegistrationRequest,
): Promise<RegistrationResponse> {
  const payload = await request<unknown>(
    `/events/${encodeURIComponent(eventId)}/registrations`,
    { method: 'POST', body: JSON.stringify(registration) },
  );
  if (
    !isRecord(payload) ||
    typeof payload.registrationId !== 'string' ||
    typeof payload.galleryToken !== 'string' ||
    typeof payload.uploadUrl !== 'string' ||
    typeof payload.expiresInSeconds !== 'number'
  )
    throw new Error('INVALID_RESPONSE');
  return {
    registrationId: payload.registrationId,
    galleryToken: payload.galleryToken,
    uploadUrl: payload.uploadUrl,
    expiresInSeconds: payload.expiresInSeconds,
  };
}

export async function getRegistrationStatus(
  registrationId: string,
  galleryToken: string,
): Promise<RegistrationStatusResponse> {
  const payload = await request<unknown>(
    `/registrations/${encodeURIComponent(registrationId)}/status`,
    { headers: { 'X-Gallery-Token': galleryToken } },
  );
  if (
    !isRecord(payload) ||
    typeof payload.registrationId !== 'string' ||
    typeof payload.status !== 'string' ||
    !REGISTRATION_STATUSES.includes(payload.status as RegistrationStatus)
  )
    throw new Error('UNKNOWN_STATUS');
  return {
    registrationId: payload.registrationId,
    status: payload.status as RegistrationStatus,
    failureReason:
      typeof payload.failureReason === 'string'
        ? payload.failureReason
        : undefined,
  };
}

// A page that keeps failing (offline, retries in a loop) must not turn into a
// stream of telemetry requests: a session reports at most this many errors.
export const MAX_ENROLLMENT_ERROR_REPORTS = 20;
let enrollmentErrorReports = 0;

/** Test hook: a fresh page starts with an empty report budget. */
export function resetEnrollmentErrorReports(): void {
  enrollmentErrorReports = 0;
}

/**
 * Sends a stage and a closed error code to the telemetry endpoint (ADR-018).
 * Fire-and-forget: it never awaits in the enrollment flow, never throws and
 * never includes event, registration, token, URL or message data.
 */
export function reportEnrollmentError(
  stage: EnrollmentErrorStage,
  error: unknown,
): void {
  if (enrollmentErrorReports >= MAX_ENROLLMENT_ERROR_REPORTS) return;
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!configured) return;
  enrollmentErrorReports += 1;
  const report: ClientEnrollmentError = {
    stage,
    code: toClientEnrollmentErrorCode(error),
  };
  try {
    void fetch(apiUrl(configured, CLIENT_ENROLLMENT_ERROR_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never affect the enrollment flow.
  }
}
