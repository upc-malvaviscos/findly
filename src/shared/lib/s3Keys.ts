export function selfieObjectKey(
  eventId: string,
  registrationId: string,
): string {
  return `events/${eventId}/selfies/${registrationId}.selfie.jpg`;
}

export function eventPhotoObjectKey(eventId: string, photoId: string): string {
  return `events/${eventId}/photos/${photoId}.photo.jpg`;
}

const EVENT_PHOTO_KEY_PATTERN =
  /^events\/([^/]+)\/photos\/([^/]+?)(?:\.photo)?\.jpg$/;

export type ParsedEventPhotoKey = { eventId: string; photoId: string };

export function parseEventPhotoObjectKey(
  key: string,
): ParsedEventPhotoKey | null {
  const match = EVENT_PHOTO_KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, eventId, photoId] = match;
  if (!eventId || !photoId) return null;
  return { eventId, photoId };
}
