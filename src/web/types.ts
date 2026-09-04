export type RegistrationStatus =
  'UPLOAD_PENDING' | 'PROCESSING' | 'ENROLLED' | 'FAILED';
export type Event = {
  id: string;
  name: string;
  date: string;
  location: string;
  description: string;
};
export type RegistrationRequest = {
  eventId: string;
  name: string;
  email: string;
  consentBiometrics: true;
  consentTerms: true;
};
export type RegistrationResponse = {
  registrationId: string;
  uploadUrl: string;
  expiresInSeconds: number;
};
export type RegistrationStatusResponse = {
  registrationId: string;
  status: RegistrationStatus;
  message: string;
};
export type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};
export type ApiError = { code: string; message: string; requestId: string };
export type GalleryPhoto = { photoId: string; url: string; matchedAt: string };
export type GalleryResponse = {
  eventId: string;
  eventName: string;
  photos: GalleryPhoto[];
  expiresAt: string;
};
