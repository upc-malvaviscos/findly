import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  emailAcceptanceScenarios,
  validateEmailAcceptanceManifest,
} from './email-acceptance-manifest.mjs';

const diagnosticScenarios = new Set([
  'preflight',
  'cleanup',
  ...emailAcceptanceScenarios,
]);
const diagnosticSteps = new Set([
  'preflight',
  'fixture-ownership',
  'write-event',
  'collection-ownership',
  'create-collection',
  'photo-ownership',
  'upload-photo',
  'write-photo',
  'registration-ownership',
  'write-registration',
  'write-capability',
  'write-inverse',
  'write-match',
  'photo-consumption',
  'scenario',
  'cleanup',
]);
const diagnosticCategories = new Set([
  'unknown',
  'Error',
  'ERR_ASSERTION',
  'AssertionError',
  'AccessDenied',
  'AccessDeniedException',
  'ConditionalCheckFailedException',
  'TransactionCanceledException',
  'ValidationException',
  'InvalidParameterException',
  'ResourceNotFoundException',
  'NotFoundException',
  'ThrottlingException',
  'TooManyRequestsException',
  'TimeoutError',
  'AbortError',
  'AWS_OPERATION_FAILED',
  'SUBPROCESS_FAILED',
]);

export function acceptanceFailureDiagnostic(cause) {
  return {
    scenario: diagnosticScenarios.has(cause?.acceptanceScenario)
      ? cause.acceptanceScenario
      : 'unknown',
    step: diagnosticSteps.has(cause?.acceptanceStep)
      ? cause.acceptanceStep
      : 'unknown',
    category: diagnosticCategories.has(cause?.acceptanceCategory)
      ? cause.acceptanceCategory
      : 'unknown',
    cleanupFailures:
      Number.isSafeInteger(cause?.acceptanceCleanupFailures) &&
      cause.acceptanceCleanupFailures >= 0 &&
      cause.acceptanceCleanupFailures <= 100
        ? cause.acceptanceCleanupFailures
        : null,
  };
}

export function requireAcceptanceApiEndpoint(actual, expected) {
  const endpoint =
    /^https:\/\/[a-z0-9]+\.execute-api\.eu-west-1\.amazonaws\.com\/?$/;
  assert(
    typeof actual === 'string' && endpoint.test(actual),
    'Invalid API endpoint',
  );
  assert(
    typeof expected === 'string' && endpoint.test(expected),
    'Invalid deployed API endpoint',
  );
  assert.equal(
    actual.replace(/\/$/, ''),
    expected.replace(/\/$/, ''),
    'API endpoint ownership mismatch',
  );
}

export function acceptanceProviders(phase) {
  assert(
    ['synthetic', 'single-recipient', 'recipients'].includes(phase),
    'Unknown acceptance phase',
  );
  return phase === 'synthetic'
    ? []
    : phase === 'single-recipient'
      ? ['A']
      : ['A', 'B'];
}

export function requireAcceptanceRecipients(recipients, phase) {
  const providers = acceptanceProviders(phase);
  assert(Array.isArray(recipients), 'Private recipient array required');
  assert.equal(
    recipients.length,
    providers.length,
    'Authorize the exact number of recipients for this phase',
  );
  assert(
    recipients.every(
      (address) =>
        typeof address === 'string' &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
    ),
    'Invalid private recipient input',
  );
  if (providers.length === 2) {
    assert(
      recipients[0].toLowerCase() !== recipients[1].toLowerCase(),
      'Recipients must differ',
    );
    assert(
      recipients[0].split('@')[1].toLowerCase() !==
        recipients[1].split('@')[1].toLowerCase(),
      'Use two providers',
    );
  }
  return providers;
}

export function isOwnedAcceptanceMessage(body, fixtures) {
  try {
    let value = JSON.parse(body);
    if (typeof value.Message === 'string') value = JSON.parse(value.Message);
    const tags = value.mail?.tags;
    const eventId = value.eventId ?? tags?.eventId?.[0];
    const operationId = value.operationId ?? tags?.operationId?.[0];
    return fixtures.some(
      (fixture) =>
        fixture.eventId === eventId && fixture.operationId === operationId,
    );
  } catch {
    return false;
  }
}

export function requireAcceptanceInputs({
  manifest,
  outputs,
  jwt,
  recipients = [],
  phase = 'synthetic',
}) {
  validateEmailAcceptanceManifest(manifest);
  const value = (name) => outputs[name]?.value;
  assert.equal(value('table_name'), 'findly-production');
  assert.equal(
    value('uploads_bucket_name'),
    `findly-production-uploads-${manifest.account}-eu-west-1`,
  );
  assert.equal(value('collection_namespace'), 'findly-production');
  assert.equal(value('frontend_origin'), 'https://www.findly.barcelona');
  assert.match(
    value('api_endpoint') ?? '',
    /^https:\/\/[a-z0-9]+\.execute-api\.eu-west-1\.amazonaws\.com\/?$/,
  );
  assert(
    typeof jwt === 'string' && jwt.length > 20,
    'Private organizer authentication required',
  );
  requireAcceptanceRecipients(recipients, phase);
}

export async function moveExactAcceptanceMessage({
  fixture,
  adapter,
  timeoutMs,
  wait,
  now,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const messages = await adapter.receiveDeadLetters();
    for (const message of messages) {
      let body;
      try {
        body = JSON.parse(message.Body);
      } catch {
        body = undefined;
      }
      if (
        body?.eventId !== fixture.eventId ||
        body?.operationId !== fixture.operationId
      ) {
        await adapter.releaseDeadLetter(message.ReceiptHandle);
        throw new Error('Foreign DLQ message preserved; acceptance aborted');
      }
      // Repair only this manifest-owned operation before requeueing its exact body.
      await adapter.removeCursor(fixture.eventId, fixture.operationId);
      await adapter.sendWork(message.Body, randomUUID());
      // Delete only after SendMessage succeeds; a retry retains the same UUID.
      await adapter.deleteDeadLetter(message.ReceiptHandle);
      return;
    }
    await wait(5000);
  }
  throw new Error('Synthetic operation did not reach its DLQ before timeout');
}

export async function runEmailAcceptance({
  manifest,
  outputs,
  jwt,
  recipients = [],
  phase = 'synthetic',
  confirmRecipientEvidence,
  adapter,
  wait,
  now = Date.now,
  pollTimeoutMs = 180000,
  dlqTimeoutMs = 2100000,
  cleanupQuiescenceMs = 65000,
  executionBudgetMs = 2400000,
}) {
  requireAcceptanceInputs({ manifest, outputs, jwt, recipients, phase });
  const providers = acceptanceProviders(phase);
  if (providers.length) {
    assert.equal(
      typeof confirmRecipientEvidence,
      'function',
      'Mailbox evidence confirmation must be available before sending',
    );
  }
  const owned = [];
  const results = [];
  let suppressionCreated = false;
  let stage = 'preflight';
  let step = 'preflight';
  let failedStage;
  let failedStep;
  let failedCategory;
  const cleanupFailures = [];
  // A workflow lasts 55 minutes and operator STS lasts 60. Bound all polling
  // together, rather than allocating a fresh budget to every fixture, so finally
  // has time to revoke capabilities and verify cleanup before either expires.
  assert(executionBudgetMs > 0 && executionBudgetMs <= 2400000);
  const executionDeadline = now() + executionBudgetMs;
  assert(
    Date.parse(manifest.expiresAt) > executionDeadline + 600000,
    'Manifest must leave the complete test and cleanup window available',
  );
  const remaining = () => {
    const value = executionDeadline - now();
    assert(value > 0, 'Acceptance execution budget exhausted');
    return value;
  };
  const ttl = Math.floor(Date.parse(manifest.expiresAt) / 1000);
  const key = (PK, SK) => ({ PK, SK });
  const operation = (fixture) => ({
    ...key(`EVENT#${fixture.eventId}`, `EMAIL#${fixture.operationId}`),
    operationId: fixture.operationId,
    status: 'RUNNING',
    revision: 0,
    updatedAt: now(),
    ttl,
    accepted: 0,
    skipped: 0,
    missingEmail: 0,
    failed: 0,
    uncertain: 0,
    bounced: 0,
    complained: 0,
  });
  async function poll(check, timeout = pollTimeoutMs) {
    const deadline = now() + Math.min(timeout, remaining());
    while (now() < deadline) {
      const result = await check();
      if (result) return result;
      await wait(2000);
    }
    throw new Error('Acceptance phase timed out');
  }
  async function status(fixture) {
    return adapter.api(
      'GET',
      `/admin/events/${fixture.eventId}/gallery-emails/${fixture.operationId}`,
    );
  }
  async function request(fixture) {
    return adapter.api(
      'POST',
      `/admin/events/${fixture.eventId}/gallery-emails`,
      { operationId: fixture.operationId },
    );
  }
  async function completed(fixture) {
    return poll(async () => {
      const value = await status(fixture);
      return value.status === 'COMPLETED' ? value : false;
    });
  }
  async function seed(fixture, emails, options = {}) {
    const event = {
      ...key(`EVENT#${fixture.eventId}`, 'METADATA'),
      eventId: fixture.eventId,
      name: 'Synthetic email acceptance',
      date: new Date(now()).toISOString(),
      createdAt: new Date(
        now() - (options.expired ? 172800000 : 0),
      ).toISOString(),
      retentionDays: 1,
      status: 'OPEN',
      ttl,
      acceptanceRunId: manifest.runId,
    };
    step = 'fixture-ownership';
    assert.equal(
      await adapter.get(key(event.PK, event.SK)),
      undefined,
      'Acceptance event already exists',
    );
    const entry = {
      fixture,
      registrations: [],
      erasedRegistrations: new Set(),
      collection: false,
      photo: false,
    };
    owned.push(entry);
    step = 'write-event';
    await adapter.put(event);
    step = 'collection-ownership';
    assert.equal(
      await adapter.collectionExists(fixture.collectionId),
      false,
      'Acceptance collection already exists',
    );
    entry.collection = true;
    step = 'create-collection';
    await adapter.createCollection(fixture.collectionId);
    step = 'photo-ownership';
    assert.equal(
      await adapter.photoExists(fixture.photoKey),
      false,
      'Acceptance photo already exists',
    );
    entry.photo = true;
    step = 'upload-photo';
    await adapter.uploadPhoto(fixture.photoKey);
    step = 'write-photo';
    await adapter.put({
      ...key(`EVENT#${fixture.eventId}`, `PHOTO#${fixture.photoId}`),
      eventId: fixture.eventId,
      photoId: fixture.photoId,
      s3Key: fixture.photoKey,
      uploadedAt: new Date(now()).toISOString(),
      ttl,
    });
    for (const [index, email] of emails.entries()) {
      const registration = fixture.registrations[index];
      step = 'registration-ownership';
      assert.equal(
        await adapter.get(
          key(`EVENT#${fixture.eventId}`, `REG#${registration.registrationId}`),
        ),
        undefined,
        'Acceptance registration already exists',
      );
      entry.registrations.push(registration);
      step = 'write-registration';
      await adapter.put({
        ...key(
          `EVENT#${fixture.eventId}`,
          `REG#${registration.registrationId}`,
        ),
        eventId: fixture.eventId,
        registrationId: registration.registrationId,
        email,
        consentTimestamp: new Date(now()).toISOString(),
        status: 'ENROLLED',
        ttl,
        ...(options.erased && {
          erasureRequestedAt: new Date(now()).toISOString(),
        }),
      });
      step = 'write-capability';
      await adapter.put({
        ...key(`TOKEN#${registration.tokenHash}`, 'METADATA'),
        tokenHash: registration.tokenHash,
        registrationId: registration.registrationId,
        eventId: fixture.eventId,
        ttl,
        expiresAt: manifest.expiresAt,
        requireRegistration: true,
      });
      step = 'write-inverse';
      await adapter.put({
        ...key(
          `REG#${registration.registrationId}`,
          `TOKEN#${registration.tokenHash}`,
        ),
        tokenHash: registration.tokenHash,
      });
      step = 'write-match';
      await adapter.put({
        ...key(
          `REG#${registration.registrationId}`,
          `MATCH#${fixture.photoId}`,
        ),
        eventId: fixture.eventId,
        registrationId: registration.registrationId,
        photoId: fixture.photoId,
        matchId: randomUUID(),
        similarity: 100,
        matchedAt: new Date(now()).toISOString(),
        ttl,
      });
    }
    // The object notification traverses the normal matcher; do not leave a photo
    // message behind that could fail after deleting its collection/object.
    step = 'photo-consumption';
    await poll(() => adapter.photoProcessed(fixture.eventId, fixture.photoId));
    return entry;
  }
  const feedback = (fixture, kind) => ({
    Records: [
      {
        body: JSON.stringify({
          eventType: kind,
          ...(kind === 'Bounce' && { bounce: { bounceType: 'Permanent' } }),
          mail: {
            tags: {
              eventId: [fixture.eventId],
              operationId: [fixture.operationId],
              registrationId: [fixture.registrations[0].registrationId],
            },
          },
        }),
      },
    ],
  });
  try {
    await adapter.preflight();
    for (const fixture of manifest.fixtures) {
      stage = fixture.scenario;
      if ((stage === 'recipients') !== providers.length > 0) continue;
      remaining();
      let emails = [
        stage === 'bounce'
          ? 'bounce@simulator.amazonses.com'
          : stage === 'complaint'
            ? 'complaint@simulator.amazonses.com'
            : stage === 'suppression'
              ? manifest.suppressionAddress
              : 'success@simulator.amazonses.com',
      ];
      if (stage === 'api') emails = [...emails, ...emails];
      if (stage === 'recipients') emails = recipients;
      const entry = await seed(fixture, emails, {
        expired: stage === 'expired',
        erased: stage === 'erased',
      });
      step = 'scenario';
      if (
        ['accepted-recovery', 'uncertain-recovery', 'dlq', 'expired'].includes(
          stage,
        )
      ) {
        await adapter.put({
          ...operation(fixture),
          ...(stage === 'dlq' && {
            cursor: { PK: `EVENT#${fixture.eventId}` },
          }),
        });
        if (stage.endsWith('recovery'))
          await adapter.put({
            ...key(
              `REG#${entry.registrations[0].registrationId}`,
              `EMAIL#${fixture.operationId}`,
            ),
            state: stage === 'accepted-recovery' ? 'accepted' : 'SENDING',
            ttl,
          });
      }
      if (stage === 'suppression') {
        assert.equal(
          await adapter.suppressed(manifest.suppressionAddress),
          false,
          'Synthetic suppression entry already exists',
        );
        suppressionCreated = true;
        await adapter.addSuppression(manifest.suppressionAddress);
      }
      if (stage === 'expired') {
        await adapter.api(
          'POST',
          `/admin/events/${fixture.eventId}/gallery-emails`,
          { operationId: randomUUID() },
          410,
        );
        await adapter.invokeWorker({
          Records: [
            {
              body: JSON.stringify({
                eventId: fixture.eventId,
                operationId: fixture.operationId,
              }),
            },
          ],
        });
      } else {
        await request(fixture);
      }
      if (stage === 'dlq')
        await moveExactAcceptanceMessage({
          fixture,
          adapter,
          timeoutMs: Math.min(dlqTimeoutMs, remaining()),
          wait,
          now,
        });
      const final = await completed(fixture);
      const expected =
        stage === 'uncertain-recovery'
          ? 'uncertain'
          : ['suppression', 'expired', 'erased'].includes(stage)
            ? 'skipped'
            : 'accepted';
      assert.equal(
        final[expected],
        emails.length,
        'Unexpected synthetic result count',
      );
      for (const field of [
        'accepted',
        'skipped',
        'missingEmail',
        'failed',
        'uncertain',
      ])
        if (field !== expected)
          assert.equal(final[field], 0, 'Unexpected additional outcome');
      if (stage === 'recipients') {
        // Keep galleries valid until the authorized mailbox flow confirms the
        // links actually received, rather than opening the initial fixture token.
        const evidence = await confirmRecipientEvidence(fixture);
        assert.equal(
          evidence.length,
          providers.length,
          'Every authorized mailbox confirmation required',
        );
        for (const receipt of evidence) {
          assert.equal(receipt.received, true);
          assert.equal(receipt.opened, true);
          assert(['inbox', 'spam'].includes(receipt.folder));
          for (const name of ['spf', 'dkim', 'dmarc'])
            assert.equal(receipt[name], 'pass');
        }
      }
      if (stage === 'api') {
        const before = await Promise.all(
          entry.registrations.map((registration) =>
            adapter.query(`REG#${registration.registrationId}`),
          ),
        );
        await request(fixture);
        const after = await completed(fixture);
        assert.equal(
          after.accepted,
          final.accepted,
          'Repeated UUID changed accepted count',
        );
        assert.deepEqual(
          await Promise.all(
            entry.registrations.map((registration) =>
              adapter.query(`REG#${registration.registrationId}`),
            ),
          ),
          before,
          'Repeated UUID changed recipient/token state',
        );
      }
      if (stage === 'bounce' || stage === 'complaint') {
        const kind = stage === 'bounce' ? 'Bounce' : 'Complaint';
        const field = stage === 'bounce' ? 'bounced' : 'complained';
        await poll(async () => (await status(fixture))[field] === 1);
        await adapter.invokeFeedback(feedback(fixture, kind));
        assert.equal(
          (await status(fixture))[field],
          1,
          'Duplicate feedback changed count',
        );
        const registration = entry.registrations[0];
        await adapter.erase(
          registration.registrationId,
          registration.capability,
        );
        entry.erasedRegistrations.add(registration.registrationId);
        await adapter.invokeFeedback(feedback(fixture, kind));
        assert.equal(
          (await adapter.query(`REG#${registration.registrationId}`)).length,
          0,
          'Late feedback resurrected recipient state',
        );
        assert.equal(
          (await status(fixture))[field],
          1,
          'Late feedback changed count',
        );
      }
      if (
        [
          'accepted-recovery',
          'uncertain-recovery',
          'suppression',
          'expired',
          'erased',
        ].includes(stage)
      ) {
        const rows = await adapter.query(
          `REG#${entry.registrations[0].registrationId}`,
        );
        assert.equal(
          rows.filter((item) => item.SK.startsWith('TOKEN#')).length,
          1,
          'Non-sending case created an additional token',
        );
      }
      results.push({
        scenario: stage,
        outcome: expected,
        count: final[expected],
      });
    }
  } catch (cause) {
    failedStage = stage;
    failedStep = step;
    const category = cause?.code ?? cause?.name;
    failedCategory = diagnosticCategories.has(category) ? category : 'unknown';
  } finally {
    const cleanupDeadline = now() + 420000;
    const requireCleanupTime = () => {
      assert(
        cleanupDeadline - now() > 60000,
        'Cleanup budget exhausted; private references preserved for retry',
      );
    };
    const clean = async (label, task) => {
      try {
        requireCleanupTime();
        await task();
        return true;
      } catch {
        cleanupFailures.push(label);
        return false;
      }
    };
    // Stop future eligibility, then allow every already-running worker to leave
    // its external side-effect boundary before deleting private state.
    const safeOwned = [];
    for (const entry of owned) {
      await clean('fixture ownership', async () => {
        const event = await adapter.get(
          key(`EVENT#${entry.fixture.eventId}`, 'METADATA'),
        );
        if (event) {
          assert.equal(
            event.acceptanceRunId,
            manifest.runId,
            'Preserve a foreign fixture',
          );
          safeOwned.push(entry);
        } else if (
          entry.photo ||
          entry.collection ||
          entry.registrations.length
        ) {
          // The in-memory creation ledger still owns these exact manifest IDs.
          // Missing metadata must never turn leftover private resources into a
          // successful cleanup report. Do not recreate the event to revoke it.
          entry.eventAbsent = true;
          safeOwned.push(entry);
          cleanupFailures.push('fixture metadata disappeared');
        }
      });
    }
    for (const entry of safeOwned)
      if (!entry.eventAbsent)
        entry.revocationFailed = !(await clean('event revocation', () =>
          adapter.revokeEvent(entry.fixture.eventId),
        ));
    // A failed revocation leaves the worker eligibility boundary uncertain.
    // Preserve that complete private fixture for retry instead of dismantling
    // its capabilities while an active worker may still observe it.
    const revokedOwned = safeOwned.filter((entry) => !entry.revocationFailed);
    if (revokedOwned.length)
      await clean('worker quiescence', () => wait(cleanupQuiescenceMs));
    for (const entry of revokedOwned) {
      const pendingRegistrations = new Set();
      for (const registration of entry.registrations) {
        // A successful late-feedback erasure already revoked this capability.
        // Reusing it would correctly return 404, which is not fresh proof of erasure.
        const erased =
          entry.erasedRegistrations.has(registration.registrationId) ||
          (await clean('registration erasure', () =>
            adapter.erase(registration.registrationId, registration.capability),
          ));
        if (!erased) {
          // Erasure owns every additional capability minted by the worker. Its
          // inverse references must survive an API failure so a private retry
          // can still find and revoke those tokens without a TOKEN# wildcard.
          pendingRegistrations.add(registration.registrationId);
          continue;
        }
        await clean('registration partition', async () => {
          for (const item of await adapter.query(
            `REG#${registration.registrationId}`,
          )) {
            requireCleanupTime();
            await adapter.delete(key(item.PK, item.SK));
          }
        });
        await clean('initial capability', () =>
          adapter.delete(key(`TOKEN#${registration.tokenHash}`, 'METADATA')),
        );
      }
      await clean('event partition', async () => {
        for (const item of await adapter.query(
          `EVENT#${entry.fixture.eventId}`,
        ))
          if (
            !(pendingRegistrations.size && item.SK === 'METADATA') &&
            ![...pendingRegistrations].some(
              (registrationId) => item.SK === `REG#${registrationId}`,
            )
          ) {
            requireCleanupTime();
            await adapter.delete(key(item.PK, item.SK));
          }
      });
      if (entry.photo)
        await clean('photo object', () =>
          adapter.deletePhoto(entry.fixture.photoKey),
        );
      if (entry.collection)
        await clean('synthetic collection', () =>
          adapter.deleteCollection(entry.fixture.collectionId),
        );
      await clean('absence verification', async () => {
        if (!pendingRegistrations.size)
          assert.equal(
            (await adapter.query(`EVENT#${entry.fixture.eventId}`)).length,
            0,
          );
        for (const registration of entry.registrations) {
          if (pendingRegistrations.has(registration.registrationId)) continue;
          requireCleanupTime();
          assert.equal(
            (await adapter.query(`REG#${registration.registrationId}`)).length,
            0,
          );
          requireCleanupTime();
          assert.equal(
            await adapter.get(
              key(`TOKEN#${registration.tokenHash}`, 'METADATA'),
            ),
            undefined,
          );
        }
        if (entry.photo) {
          requireCleanupTime();
          assert.equal(
            await adapter.photoExists(entry.fixture.photoKey),
            false,
          );
        }
        if (entry.collection) {
          requireCleanupTime();
          assert.equal(
            await adapter.collectionExists(entry.fixture.collectionId),
            false,
          );
        }
      });
    }
    if (suppressionCreated)
      await clean('synthetic suppression', async () => {
        await adapter.removeSuppression(manifest.suppressionAddress);
        assert.equal(
          await adapter.suppressed(manifest.suppressionAddress),
          false,
        );
      });
    if (revokedOwned.length)
      await clean('selective queue cleanup', () =>
        adapter.cleanupQueues(
          revokedOwned.map((entry) => entry.fixture),
          cleanupDeadline - now(),
        ),
      );
  }
  if (failedStage || cleanupFailures.length) {
    const failure = new Error(
      `Email acceptance failed at ${failedStage ?? 'cleanup'}; cleanup failures: ${cleanupFailures.join(', ') || 'none'}. Production infrastructure was preserved.`,
    );
    // Only controlled labels survive; never retain exception bodies or messages.
    failure.acceptanceScenario = failedStage ?? 'cleanup';
    failure.acceptanceStep = failedStep ?? 'cleanup';
    failure.acceptanceCategory = failedCategory ?? 'unknown';
    failure.acceptanceCleanupFailures = cleanupFailures.length;
    throw failure;
  }
  return {
    results,
    cleanup: 'verified',
    originatingCrash:
      'not tested; injected-state recovery is a separate criterion',
    concurrentErasure: 'not tested; erasure preceded consumption',
    realRecipients: providers.length
      ? 'authorized mailbox receipt, authentication and opening confirmed'
      : 'not sent; authorized mailbox phase pending',
    deliverability:
      phase === 'recipients'
        ? 'two-provider evidence verified'
        : 'pending; two-provider evidence required',
  };
}
