import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const emailAcceptanceScenarios = [
  'api',
  'accepted-recovery',
  'uncertain-recovery',
  'dlq',
  'bounce',
  'complaint',
  'suppression',
  'expired',
  'erased',
  'recipients',
];
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ttl = 6 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
function keys(fixtures) {
  return fixtures.flatMap(({ eventId, registrations }) => [
    `EVENT#${eventId}`,
    ...registrations.flatMap(({ registrationId, tokenHash }) => [
      `REG#${registrationId}`,
      `TOKEN#${tokenHash}`,
    ]),
  ]);
}

export function createEmailAcceptanceManifest({
  now = Date.now(),
  runId = randomUUID(),
} = {}) {
  assert.match(runId, uuid, 'A fresh run UUID is required');
  const fixtures = emailAcceptanceScenarios.map((scenario) => {
    const eventId = `ses-acceptance-${runId}-${scenario}`;
    const photoId = randomUUID();
    return {
      scenario,
      eventId,
      operationId: randomUUID(),
      photoId,
      photoKey: `events/${eventId}/photos/${photoId}.jpg`,
      collectionId: `findly-production-event-${eventId}`,
      registrations: [1, 2].map((index) => {
        const capability = randomBytes(32).toString('base64url');
        return {
          registrationId: `${eventId}-${index}`,
          capability,
          tokenHash: hash(capability),
        };
      }),
    };
  });
  const manifest = {
    version: 1,
    account: '567158658992',
    region: 'eu-west-1',
    runId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    fixtures,
    leadingKeys: keys(fixtures),
    suppressionAddress: `success+${runId}@simulator.amazonses.com`,
  };
  validateEmailAcceptanceManifest(manifest, { now });
  return manifest;
}

export function validateEmailAcceptanceManifest(
  manifest,
  { now = Date.now(), allowExpired = false } = {},
) {
  assert(
    manifest && typeof manifest === 'object',
    'A private manifest is required',
  );
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      'version',
      'account',
      'region',
      'runId',
      'createdAt',
      'expiresAt',
      'fixtures',
      'leadingKeys',
      'suppressionAddress',
    ].sort(),
    'Unreviewed manifest fields',
  );
  assert.equal(manifest.version, 1);
  assert.equal(manifest.account, '567158658992');
  assert.equal(manifest.region, 'eu-west-1');
  assert.match(manifest.runId, uuid);
  const created = Date.parse(manifest.createdAt);
  const expires = Date.parse(manifest.expiresAt);
  assert(
    Number.isFinite(created) && Number.isFinite(expires),
    'Invalid manifest dates',
  );
  assert(
    expires > created && expires - created <= ttl,
    'Manifest lifetime exceeds six hours',
  );
  assert(created <= now + 60000, 'Manifest is from the future');
  assert(allowExpired || expires > now, 'Manifest has expired');
  assert.deepEqual(
    manifest.fixtures.map(({ scenario }) => scenario),
    emailAcceptanceScenarios,
  );
  const unique = new Set();
  for (const fixture of manifest.fixtures) {
    const eventId = `ses-acceptance-${manifest.runId}-${fixture.scenario}`;
    assert.equal(fixture.eventId, eventId);
    assert.match(fixture.operationId, uuid);
    assert.match(fixture.photoId, uuid);
    assert.equal(
      fixture.photoKey,
      `events/${eventId}/photos/${fixture.photoId}.jpg`,
    );
    assert.equal(fixture.collectionId, `findly-production-event-${eventId}`);
    assert.equal(fixture.registrations.length, 2);
    fixture.registrations.forEach(
      ({ registrationId, capability, tokenHash }, index) => {
        assert.equal(registrationId, `${eventId}-${index + 1}`);
        assert(
          typeof capability === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(capability),
          'Invalid private capability',
        );
        assert(tokenHash === hash(capability), 'Capability hash mismatch');
        assert(!unique.has(tokenHash), 'Capabilities must be unique');
        unique.add(tokenHash);
      },
    );
  }
  assert(
    JSON.stringify(manifest.leadingKeys) ===
      JSON.stringify(keys(manifest.fixtures)),
    'Unreviewed leading keys',
  );
  assert(
    manifest.suppressionAddress ===
      `success+${manifest.runId}@simulator.amazonses.com`,
    'Only the unique synthetic suppression destination is authorized',
  );
  return manifest;
}
