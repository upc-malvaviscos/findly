export function selfieObjectKey(eventId: string, registrationId: string): string {
  return `events/${eventId}/selfies/${registrationId}.jpg`;
}

export function eventPhotoObjectKey(eventId: string, photoId: string): string {
  return `events/${eventId}/photos/${photoId}.jpg`;
}

const EVENT_PHOTO_KEY_PATTERN =
  /^events\/([^/]+)\/photos\/([^/]+)\.jpg$/;

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
