export interface PublicEvent {
  eventId: string;
  name: string;
  date: string;
}

export interface EventsResponse {
  events: PublicEvent[];
}

export interface RegistrationRequest {
  email?: string;
  consentBiometrics: true;
  consentTerms: true;
}

export interface RegistrationResponse {
  registrationId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export type RegistrationStatus =
  'UPLOAD_PENDING' | 'PROCESSING' | 'ENROLLED' | 'FAILED';

export interface RegistrationStatusResponse {
  registrationId: string;
  status: RegistrationStatus;
  failureReason?: string;
}

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
}

export interface AdminEvent {
  eventId: string;
  name: string;
  date: string;
  retentionDays: number;
  createdAt: string;
  status: string;
}

export interface AdminEventsResponse {
  events: AdminEvent[];
}

export interface CreateAdminEventRequest {
  name: string;
  date: string;
  retentionDays: number;
}

export interface CreateAdminEventResponse {
  eventId: string;
}

export interface PhotoUploadRequest {
  files: Array<{ fileName: string; contentType: 'image/jpeg' }>;
}

export interface PhotoUploadResponse {
  uploads: Array<{
    photoId: string;
    uploadUrl: string;
    expiresInSeconds: 300;
  }>;
}
