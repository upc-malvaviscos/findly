export function eventCollectionId(eventId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(eventId))
    throw new Error('INVALID_COLLECTION_EVENT_ID');
  const namespace = process.env.FINDLY_COLLECTION_NAMESPACE;
  let prefix: string;
  if (namespace) {
    if (namespace.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(namespace))
      throw new Error('INVALID_COLLECTION_NAMESPACE');
    prefix = namespace;
  } else {
    const endpoint = process.env.AWS_ENDPOINT_URL;
    const localEndpoint = endpoint
      ? ['localhost', '127.0.0.1', '[::1]', 'floci'].includes(
          new URL(endpoint).hostname,
        )
      : false;
    const explicitLocalLegacy =
      process.env.FINDLY_ALLOW_LEGACY_COLLECTIONS === '1' &&
      !process.env.AWS_LAMBDA_FUNCTION_NAME &&
      (process.env.NODE_ENV === 'test' || localEndpoint);
    if (!explicitLocalLegacy) throw new Error('COLLECTION_NAMESPACE_REQUIRED');
    prefix = 'findly';
  }
  const collection = `${prefix}-event-${eventId}`;
  if (collection.length > 255) throw new Error('COLLECTION_ID_TOO_LONG');
  return collection;
}
