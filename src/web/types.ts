export type {
  RegistrationRequest,
  RegistrationResponse,
  RegistrationStatus,
  RegistrationStatusResponse,
} from '../shared/types/api';

export type Event = {
  eventId: string;
  name: string;
  date: string;
  location: string;
  description: string;
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
