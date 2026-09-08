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
