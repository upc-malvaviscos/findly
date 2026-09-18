import { apiClient, apiUrl } from './apiClient';
import { executionMode } from './executionMode';
import type {
  AdminEvent,
  AdminEventsResponse,
  CreateAdminEventRequest,
  CreateAdminEventResponse,
  PhotoUploadRequest,
  PhotoUploadResponse,
} from '../shared/types/api';

const mockEvents: AdminEvent[] = [];

function localEvent(request: CreateAdminEventRequest): AdminEvent {
  const event: AdminEvent = {
    eventId: `evt-local-${crypto.randomUUID()}`,
    ...request,
    createdAt: new Date().toISOString(),
    status: 'OPEN',
  };
  mockEvents.push(event);
  return event;
}

function requiredApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!value) throw new Error('ADMIN_API_NOT_CONFIGURED');
  return value;
}

export async function getAdminEvents(
  token: string,
): Promise<AdminEventsResponse> {
  if (executionMode === 'mock') return { events: [...mockEvents] };
  return apiClient(apiUrl(requiredApiBaseUrl(), '/admin/events'), { token });
}

export async function createAdminEvent(
  token: string,
  request: CreateAdminEventRequest,
): Promise<CreateAdminEventResponse> {
  if (executionMode === 'mock') return { eventId: localEvent(request).eventId };
  return apiClient(apiUrl(requiredApiBaseUrl(), '/admin/events'), {
    method: 'POST',
    body: JSON.stringify(request),
    token,
  });
}

export async function requestPhotoUploads(
  token: string,
  eventId: string,
  request: PhotoUploadRequest,
): Promise<PhotoUploadResponse> {
  if (executionMode === 'mock')
    return {
      uploads: request.files.map((file) => ({
        photoId: crypto.randomUUID(),
        uploadUrl: `mock://findly/events/${eventId}/photos/${encodeURIComponent(file.fileName)}`,
        expiresInSeconds: 300,
      })),
    };
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}/photos/uploads`,
    ),
    { method: 'POST', body: JSON.stringify(request), token },
  );
}
