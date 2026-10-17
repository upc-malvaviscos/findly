import { apiClient, apiUrl } from './apiClient';
import { executionMode } from './executionMode';
import type {
  GalleryEmailOperation,
  AdminEvent,
  AdminEventsResponse,
  CreateAdminEventRequest,
  CreateAdminEventResponse,
  EventPhotosResponse,
  PhotoUploadRequest,
  PhotoUploadResponse,
  UpdateAdminEventRequest,
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

export async function updateAdminEvent(
  token: string,
  eventId: string,
  request: UpdateAdminEventRequest,
): Promise<AdminEvent> {
  if (executionMode === 'mock') {
    const existing = mockEvents.find((event) => event.eventId === eventId);
    if (!existing) throw new Error('EVENT_NOT_FOUND');
    const updated: AdminEvent = { ...existing, ...request };
    mockEvents.splice(mockEvents.indexOf(existing), 1, updated);
    return updated;
  }
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}`,
    ),
    { method: 'PATCH', body: JSON.stringify(request), token },
  );
}

export async function getEventPhotos(
  token: string,
  eventId: string,
  cursor?: string,
): Promise<EventPhotosResponse> {
  if (executionMode === 'mock') return { photos: [] };
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}/photos${query}`,
    ),
    { token },
  );
}

async function deleteNoContent(
  token: string,
  path: string,
  notFoundCode: string,
): Promise<void> {
  const response = await fetch(apiUrl(requiredApiBaseUrl(), path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 204) return;
  let payload: { code?: string } = {};
  try {
    payload = (await response.json()) as { code?: string };
  } catch {
    // Keep the public error stable when the upstream response is not JSON.
  }
  throw new Error(payload.code ?? notFoundCode);
}

export async function deleteEventPhoto(
  token: string,
  eventId: string,
  photoId: string,
): Promise<void> {
  if (executionMode === 'mock') return;
  await deleteNoContent(
    token,
    `/admin/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(photoId)}`,
    'ADMIN_NETWORK_ERROR',
  );
}

export async function deleteAdminEvent(
  token: string,
  eventId: string,
): Promise<void> {
  if (executionMode === 'mock') {
    const index = mockEvents.findIndex((event) => event.eventId === eventId);
    if (index !== -1) mockEvents.splice(index, 1);
    return;
  }
  await deleteNoContent(
    token,
    `/admin/events/${encodeURIComponent(eventId)}`,
    'ADMIN_NETWORK_ERROR',
  );
}

export async function requestPhotoUploads(
  token: string,
  eventId: string,
  request: PhotoUploadRequest,
): Promise<PhotoUploadResponse> {
  if (executionMode === 'mock')
    return {
      // photoId mirrors the client-generated operationId (issue #121), so a
      // retry of the same file in mock mode also keeps the same photoId.
      uploads: request.files.map((file) => ({
        photoId: file.operationId,
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

const mockEmailOperations = new Map<string, GalleryEmailOperation>();
export async function requestGalleryEmail(
  token: string,
  eventId: string,
  operationId: string,
): Promise<GalleryEmailOperation> {
  if (executionMode === 'mock') {
    const key = `${eventId}/${operationId}`;
    const existing = mockEmailOperations.get(key);
    if (existing) return existing;
    const operation: GalleryEmailOperation = {
      operationId,
      status: 'COMPLETED',
      accepted: 0,
      skipped: 0,
      missingEmail: 0,
      failed: 0,
      uncertain: 0,
      bounced: 0,
      complained: 0,
    };
    mockEmailOperations.set(key, operation);
    return operation;
  }
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}/gallery-emails`,
    ),
    { token, method: 'POST', body: JSON.stringify({ operationId }) },
  );
}
export async function getGalleryEmailStatus(
  token: string,
  eventId: string,
  operationId: string,
): Promise<GalleryEmailOperation> {
  if (executionMode === 'mock') {
    const existing = mockEmailOperations.get(`${eventId}/${operationId}`);
    if (!existing) throw new Error('EMAIL_OPERATION_NOT_FOUND');
    return existing;
  }
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}/gallery-emails/${encodeURIComponent(operationId)}`,
    ),
    { token },
  );
}
