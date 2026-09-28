import assert from 'node:assert/strict';
import { eventCollectionId } from '../../src/shared/lib/rekognitionCollections.ts';

export function requireEphemeralCollectionNamespace() {
  const namespace = process.env.EPHEMERAL_COLLECTION_NAMESPACE;
  assert(
    namespace && /^findly-pr-[0-9]+$/.test(namespace),
    'An isolated PR collection namespace output is required.',
  );
  assert.equal(
    namespace,
    process.env.EPHEMERAL_RESOURCE_PREFIX,
    'Collection namespace and PR resource prefix must agree.',
  );
  process.env.FINDLY_COLLECTION_NAMESPACE = namespace;
  return namespace;
}

export function ephemeralCollectionId(eventId) {
  requireEphemeralCollectionNamespace();
  return eventCollectionId(eventId);
}
