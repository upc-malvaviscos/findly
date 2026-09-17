import { apiClient, apiUrl } from './apiClient';
import type {
  AdminEventsResponse,
  CreateAdminEventRequest,
  CreateAdminEventResponse,
  PhotoUploadRequest,
  PhotoUploadResponse,
} from '../shared/types/api';

function requiredApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!value) throw new Error('ADMIN_API_NOT_CONFIGURED');
  return value;
}

export async function getAdminEvents(
  token: string,
): Promise<AdminEventsResponse> {
  return apiClient(apiUrl(requiredApiBaseUrl(), '/admin/events'), { token });
}

export async function createAdminEvent(
  token: string,
  request: CreateAdminEventRequest,
): Promise<CreateAdminEventResponse> {
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
  return apiClient(
    apiUrl(
      requiredApiBaseUrl(),
      `/admin/events/${encodeURIComponent(eventId)}/photos/uploads`,
    ),
    { method: 'POST', body: JSON.stringify(request), token },
  );
}
