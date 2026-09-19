import { apiClient, apiUrl } from './apiClient';
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
    typeof payload.uploadUrl !== 'string' ||
    typeof payload.expiresInSeconds !== 'number'
  )
    throw new Error('INVALID_RESPONSE');
  return {
    registrationId: payload.registrationId,
    uploadUrl: payload.uploadUrl,
    expiresInSeconds: payload.expiresInSeconds,
  };
}

export async function getRegistrationStatus(
  registrationId: string,
): Promise<RegistrationStatusResponse> {
  const payload = await request<unknown>(
    `/registrations/${encodeURIComponent(registrationId)}/status`,
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
