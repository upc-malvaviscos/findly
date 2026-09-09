export function selfieObjectKey(eventId: string, registrationId: string): string {
  return `events/${eventId}/selfies/${registrationId}.jpg`;
}

export function eventPhotoObjectKey(eventId: string, photoId: string): string {
  return `events/${eventId}/photos/${photoId}.jpg`;
}
