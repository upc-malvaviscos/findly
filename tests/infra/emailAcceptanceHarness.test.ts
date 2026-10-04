import { describe, expect, it, vi } from 'vitest';
import { createEmailAcceptanceManifest } from '../../scripts/lib/email-acceptance-manifest.mjs';
import {
  moveExactAcceptanceMessage,
  isOwnedAcceptanceMessage,
  requireAcceptanceInputs,
  runEmailAcceptance,
} from '../../scripts/lib/email-acceptance-harness.mjs';
import type {
  AcceptanceRow,
  AcceptanceStatus,
  EmailAcceptanceAdapter,
} from '../../scripts/lib/email-acceptance-harness.mjs';

const manifest = createEmailAcceptanceManifest();
const outputs = {
  table_name: { value: 'findly-production' },
  uploads_bucket_name: {
    value: `findly-production-uploads-${manifest.account}-eu-west-1`,
  },
  collection_namespace: { value: 'findly-production' },
  frontend_origin: { value: 'https://www.findly.barcelona' },
  api_endpoint: {
    value: 'https://synthetic.execute-api.eu-west-1.amazonaws.com',
  },
};
const jwt = 'private-synthetic-organizer-credential';
const fixture = manifest.fixtures.find((item) => item.scenario === 'dlq')!;

function harness() {
  const rows = new Map<string, AcceptanceRow>();
  const photos = new Set<string>();
  const collections = new Set<string>();
  const statuses = new Map<string, AcceptanceStatus>();
  const suppressions = new Set<string>();
  const locate = (id: string) =>
    manifest.fixtures.find((item) => item.eventId === id)!;
  function complete(eventId: string) {
    const fixture = locate(eventId);
    const name = fixture.scenario;
    const outcome =
      name === 'uncertain-recovery'
        ? 'uncertain'
        : ['suppression', 'expired', 'erased'].includes(name)
          ? 'skipped'
          : 'accepted';
    statuses.set(eventId, {
      status: 'COMPLETED',
      accepted: 0,
      skipped: 0,
      missingEmail: 0,
      failed: 0,
      uncertain: 0,
      bounced: name === 'bounce' ? 1 : 0,
      complained: name === 'complaint' ? 1 : 0,
      [outcome]: ['api', 'recipients'].includes(name) ? 2 : 1,
    });
  }
  const adapter: EmailAcceptanceAdapter = {
    preflight: vi.fn(async () => {}),
    api: vi.fn(async (method, path, _body, expected) => {
      const eventId = path.split('/')[3];
      if (expected === 410) return { status: 'EXPIRED' };
      if (method === 'POST' && !statuses.has(eventId)) {
        if (locate(eventId).scenario === 'dlq')
          statuses.set(eventId, { status: 'RUNNING' });
        else complete(eventId);
      }
      return statuses.get(eventId)!;
    }),
    put: vi.fn(async (item) => {
      const key = `${item.PK}/${item.SK}`;
      if (rows.has(key)) throw new Error('Existing fixture');
      rows.set(key, item);
    }),
    get: vi.fn(async (key) => rows.get(`${key.PK}/${key.SK}`)),
    query: vi.fn(async (pk) =>
      [...rows.values()].filter((item) => item.PK === pk),
    ),
    delete: vi.fn(async (key) => {
      rows.delete(`${key.PK}/${key.SK}`);
    }),
    erase: vi.fn(async (id) => {
      const registration = manifest.fixtures
        .flatMap((item) => item.registrations)
        .find((item) => item.registrationId === id)!;
      for (const [key, row] of rows)
        if (
          row.PK === `REG#${id}` ||
          row.PK === `TOKEN#${registration.tokenHash}` ||
          row.SK === `REG#${id}`
        )
          rows.delete(key);
    }),
    revokeEvent: vi.fn(async () => {}),
    removeCursor: vi.fn(async () => {}),
    createCollection: vi.fn(async (id) => {
      collections.add(id);
    }),
    deleteCollection: vi.fn(async (id) => {
      collections.delete(id);
    }),
    collectionExists: vi.fn(async (id) => collections.has(id)),
    uploadPhoto: vi.fn(async (key) => {
      photos.add(key);
    }),
    deletePhoto: vi.fn(async (key) => {
      photos.delete(key);
    }),
    photoExists: vi.fn(async (key) => photos.has(key)),
    photoProcessed: vi.fn(async () => true),
    receiveDeadLetters: vi.fn(async () => [
      {
        Body: JSON.stringify({
          eventId: fixture.eventId,
          operationId: fixture.operationId,
        }),
        ReceiptHandle: 'private-receipt',
      },
    ]),
    releaseDeadLetter: vi.fn(async () => {}),
    deleteDeadLetter: vi.fn(async () => {}),
    sendWork: vi.fn(async (body) => {
      complete(JSON.parse(body).eventId);
    }),
    invokeWorker: vi.fn(async (payload) => {
      complete(JSON.parse(payload.Records[0].body).eventId);
    }),
    invokeFeedback: vi.fn(async () => {}),
    suppressed: vi.fn(async (address) => suppressions.has(address)),
    addSuppression: vi.fn(async (address) => {
      suppressions.add(address);
    }),
    removeSuppression: vi.fn(async (address) => {
      suppressions.delete(address);
    }),
    cleanupQueues: vi.fn(async () => {}),
  };
  return { adapter, rows, photos, collections, suppressions };
}
const wait = async () => {};

describe('email acceptance orchestration (local adapters, not AWS evidence)', () => {
  it('recognizes only exact owned work and SNS feedback messages for cleanup', () => {
    const owned = {
      eventId: fixture.eventId,
      operationId: fixture.operationId,
    };
    expect(isOwnedAcceptanceMessage(JSON.stringify(owned), [fixture])).toBe(
      true,
    );
    expect(
      isOwnedAcceptanceMessage(
        JSON.stringify({
          Message: JSON.stringify({
            mail: {
              tags: {
                eventId: [fixture.eventId],
                operationId: [fixture.operationId],
              },
            },
          }),
        }),
        [fixture],
      ),
    ).toBe(true);
    expect(
      isOwnedAcceptanceMessage(
        JSON.stringify({ ...owned, operationId: 'foreign' }),
        [fixture],
      ),
    ).toBe(false);
    expect(isOwnedAcceptanceMessage('invalid', [fixture])).toBe(false);
  });
  it('rejects foreign production outputs before performing work', () => {
    expect(() =>
      requireAcceptanceInputs({
        manifest,
        outputs: { ...outputs, table_name: { value: 'findly-demo' } },
        jwt,
      }),
    ).toThrow();
  });
  it('releases foreign DLQ messages without moving or deleting them', async () => {
    const { adapter } = harness();
    vi.mocked(adapter.receiveDeadLetters).mockResolvedValue([
      {
        Body: JSON.stringify({
          eventId: 'foreign',
          operationId: fixture.operationId,
        }),
        ReceiptHandle: 'foreign-receipt',
      },
    ]);
    await expect(
      moveExactAcceptanceMessage({
        fixture,
        adapter,
        timeoutMs: 10000,
        now: Date.now,
        wait,
      }),
    ).rejects.toThrow('Foreign DLQ');
    expect(adapter.releaseDeadLetter).toHaveBeenCalledWith('foreign-receipt');
    expect(adapter.sendWork).not.toHaveBeenCalled();
    expect(adapter.deleteDeadLetter).not.toHaveBeenCalled();
  });
  it('preserves the original DLQ message if enqueueing its same UUID fails', async () => {
    const { adapter } = harness();
    vi.mocked(adapter.sendWork).mockRejectedValue(
      new Error('synthetic queue failure'),
    );
    await expect(
      moveExactAcceptanceMessage({
        fixture,
        adapter,
        timeoutMs: 10000,
        now: Date.now,
        wait,
      }),
    ).rejects.toThrow();
    expect(adapter.deleteDeadLetter).not.toHaveBeenCalled();
  });
  it('repairs and requeues the exact operation before deleting its receipt', async () => {
    const { adapter } = harness();
    await moveExactAcceptanceMessage({
      fixture,
      adapter,
      timeoutMs: 10000,
      now: Date.now,
      wait,
    });
    expect(adapter.removeCursor).toHaveBeenCalledWith(
      fixture.eventId,
      fixture.operationId,
    );
    expect(adapter.sendWork).toHaveBeenCalledWith(
      JSON.stringify({
        eventId: fixture.eventId,
        operationId: fixture.operationId,
      }),
      expect.any(String),
    );
    expect(
      vi.mocked(adapter.sendWork).mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(
      vi.mocked(adapter.deleteDeadLetter).mock.invocationCallOrder[0] ??
        -Infinity,
    );
  });
  it('requires mailbox confirmation support before sending to real recipients', async () => {
    const { adapter } = harness();
    await expect(
      runEmailAcceptance({
        manifest,
        outputs,
        jwt,
        adapter,
        wait,
        phase: 'recipients',
        recipients: ['one@example.test', 'two@other.test'],
      }),
    ).rejects.toThrow('Mailbox evidence');
    expect(adapter.put).not.toHaveBeenCalled();
  });
  it('cleans every owned resource after a failure and redacts sensitive errors', async () => {
    const { adapter, rows, collections } = harness();
    vi.mocked(adapter.uploadPhoto).mockRejectedValue(
      new Error('private@example.test token=private-sensitive-token'),
    );
    let message = '';
    try {
      await runEmailAcceptance({ manifest, outputs, jwt, adapter, wait });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('failed at api');
    expect(message).not.toMatch(/private@|token=/);
    expect(rows.size).toBe(0);
    expect(collections.size).toBe(0);
    expect(adapter.deleteCollection).toHaveBeenCalled();
  });
  it('preserves preexisting fixtures instead of overwriting or cleaning them', async () => {
    const { adapter, rows } = harness();
    const first = manifest.fixtures[0];
    if (!first) throw new Error('Synthetic fixture missing');
    const existing = {
      PK: `EVENT#${first.eventId}`,
      SK: 'METADATA',
      acceptanceRunId: 'foreign',
    };
    rows.set(`${existing.PK}/${existing.SK}`, existing);
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('failed at api');
    expect(rows.get(`${existing.PK}/${existing.SK}`)).toBe(existing);
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.revokeEvent).not.toHaveBeenCalled();
  });
  it('cleans a manifest-owned event when its write succeeds but acknowledgement fails', async () => {
    const { adapter, rows } = harness();
    vi.mocked(adapter.put).mockImplementationOnce(async (item) => {
      rows.set(`${item.PK}/${item.SK}`, item);
      throw new Error('transport lost acknowledgement');
    });
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('failed at api');
    expect(rows.size).toBe(0);
    expect(adapter.revokeEvent).toHaveBeenCalledTimes(1);
  });
  it('removes only its own newly added suppression even if acknowledgement fails', async () => {
    const { adapter, suppressions } = harness();
    vi.mocked(adapter.addSuppression).mockImplementationOnce(
      async (address) => {
        suppressions.add(address);
        throw new Error('transport lost acknowledgement');
      },
    );
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('failed at suppression');
    expect(adapter.removeSuppression).toHaveBeenCalledWith(
      manifest.suppressionAddress,
    );
    expect(suppressions.size).toBe(0);
  });
  it('runs only synthetic cases, keeps recovery limitations explicit and verifies cleanup', async () => {
    const { adapter, rows, photos, collections, suppressions } = harness();
    const result = await runEmailAcceptance({
      manifest,
      outputs,
      jwt,
      adapter,
      wait,
    });
    expect(result.results).toHaveLength(9);
    expect(result.realRecipients).toContain('not sent');
    expect(result.originatingCrash).toContain('not tested');
    expect(result.concurrentErasure).toContain('not tested');
    expect(rows.size + photos.size + collections.size + suppressions.size).toBe(
      0,
    );
    expect(adapter.invokeFeedback).toHaveBeenCalledTimes(4);
  });
  it('bounds repeated polling across fixtures and still performs cleanup', async () => {
    const { adapter, rows, photos, collections } = harness();
    let clock = Date.now();
    vi.mocked(adapter.photoProcessed).mockResolvedValue(false);
    await expect(
      runEmailAcceptance({
        manifest,
        outputs,
        jwt,
        adapter,
        now: () => clock,
        wait: async (duration) => {
          clock += duration;
        },
        executionBudgetMs: 4000,
        pollTimeoutMs: 180000,
      }),
    ).rejects.toThrow('failed at api');
    expect(adapter.photoProcessed).toHaveBeenCalledTimes(2);
    expect(rows.size + photos.size + collections.size).toBe(0);
    expect(adapter.revokeEvent).toHaveBeenCalledTimes(1);
  });
  it('does not report acceptance success when selective queue cleanup is pending', async () => {
    const { adapter, rows } = harness();
    vi.mocked(adapter.cleanupQueues).mockRejectedValue(
      new Error('private message body withheld'),
    );
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('selective queue cleanup');
    expect(rows.size).toBe(0);
    expect(adapter.cleanupQueues).toHaveBeenCalledWith(
      manifest.fixtures.filter((item) => item.scenario !== 'recipients'),
      expect.any(Number),
    );
  });
  it('stops cleanup on its shared deadline and preserves references for retry', async () => {
    const { adapter, rows } = harness();
    let clock = Date.now();
    await expect(
      runEmailAcceptance({
        manifest,
        outputs,
        jwt,
        adapter,
        now: () => clock,
        wait: async () => {
          clock += 500000;
        },
      }),
    ).rejects.toThrow('cleanup failures:');
    // Two erasures belong to the earlier bounce/complaint checks; cleanup
    // must start none after its budget expires.
    expect(adapter.erase).toHaveBeenCalledTimes(2);
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.cleanupQueues).not.toHaveBeenCalled();
    const first = manifest.fixtures.find((item) => item.scenario === 'api')!;
    expect(rows.has(`EVENT#${first.eventId}/METADATA`)).toBe(true);
    for (const registration of first.registrations) {
      expect(
        rows.has(
          `REG#${registration.registrationId}/TOKEN#${registration.tokenHash}`,
        ),
      ).toBe(true);
      expect(rows.has(`TOKEN#${registration.tokenHash}/METADATA`)).toBe(true);
    }
  });
  it('preserves capability inverses and revoked event references when erasure fails', async () => {
    const { adapter, rows } = harness();
    const first = manifest.fixtures.find((item) => item.scenario === 'api')!;
    vi.mocked(adapter.photoProcessed).mockRejectedValueOnce(
      new Error('processing failed after registrations were seeded'),
    );
    vi.mocked(adapter.erase).mockRejectedValue(new Error('erasure API failed'));
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('registration erasure');
    expect(adapter.revokeEvent).toHaveBeenCalledWith(first.eventId);
    expect(rows.has(`EVENT#${first.eventId}/METADATA`)).toBe(true);
    for (const registration of first.registrations) {
      expect(
        rows.has(`EVENT#${first.eventId}/REG#${registration.registrationId}`),
      ).toBe(true);
      expect(rows.has(`TOKEN#${registration.tokenHash}/METADATA`)).toBe(true);
      expect(
        rows.has(
          `REG#${registration.registrationId}/TOKEN#${registration.tokenHash}`,
        ),
      ).toBe(true);
      expect(
        rows.has(`REG#${registration.registrationId}/MATCH#${first.photoId}`),
      ).toBe(true);
    }
    for (const [deleted] of vi.mocked(adapter.delete).mock.calls) {
      expect(deleted.PK.startsWith('TOKEN#')).toBe(false);
      expect(deleted.PK.startsWith('REG#')).toBe(false);
      expect(deleted.SK.startsWith('REG#')).toBe(false);
    }
  });
  it('treats a real adapter erasure 404 as pending and preserves inverse capabilities', async () => {
    const modulePath = '../../scripts/test-gallery-email-aws.mjs';
    const productionModule: {
      createEmailAcceptanceAwsAdapter(
        options: Record<string, unknown>,
      ): EmailAcceptanceAdapter;
    } = await import(modulePath);
    const { adapter, rows } = harness();
    const request = vi.fn(async () => new Response(null, { status: 404 }));
    const productionAdapter = productionModule.createEmailAcceptanceAwsAdapter({
      manifest,
      outputs,
      jwt,
      fetch: request,
      credentials: {
        accessKeyId: 'synthetic',
        secretAccessKey: 'synthetic',
        sessionToken: 'synthetic',
      },
      aws: async () => {
        throw new Error('No AWS access allowed in local test');
      },
    });
    adapter.erase = productionAdapter.erase;
    vi.mocked(adapter.photoProcessed).mockRejectedValueOnce(
      new Error('stop before sending'),
    );
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('registration erasure');
    const first = manifest.fixtures.find((item) => item.scenario === 'api')!;
    for (const registration of first.registrations) {
      expect(
        rows.has(
          `REG#${registration.registrationId}/TOKEN#${registration.tokenHash}`,
        ),
      ).toBe(true);
      expect(rows.has(`TOKEN#${registration.tokenHash}/METADATA`)).toBe(true);
    }
    expect(rows.has(`EVENT#${first.eventId}/METADATA`)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('cleans the creation ledger but reports lost ownership metadata as failure', async () => {
    const { adapter, rows, photos, collections } = harness();
    vi.mocked(adapter.uploadPhoto).mockImplementationOnce(async (photoKey) => {
      photos.add(photoKey);
      rows.clear();
      throw new Error('metadata disappeared during creation');
    });
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('fixture metadata disappeared');
    expect(rows.size + photos.size + collections.size).toBe(0);
    expect(adapter.revokeEvent).not.toHaveBeenCalled();
  });
  it('preserves the complete fixture if event revocation fails', async () => {
    const { adapter, rows, photos, collections } = harness();
    vi.mocked(adapter.photoProcessed).mockRejectedValueOnce(
      new Error('stop before sending'),
    );
    vi.mocked(adapter.revokeEvent).mockRejectedValueOnce(
      new Error('revocation failed'),
    );
    await expect(
      runEmailAcceptance({ manifest, outputs, jwt, adapter, wait }),
    ).rejects.toThrow('event revocation');
    expect(rows.size).toBeGreaterThan(0);
    expect(photos.size).toBe(1);
    expect(collections.size).toBe(1);
    expect(adapter.erase).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.deletePhoto).not.toHaveBeenCalled();
    expect(adapter.deleteCollection).not.toHaveBeenCalled();
    expect(adapter.cleanupQueues).not.toHaveBeenCalled();
  });
  it('keeps real galleries until received-link evidence is confirmed, then cleans them', async () => {
    const { adapter, rows, photos } = harness();
    const confirmation = vi.fn(async () => {
      expect(photos.size).toBe(1);
      expect(
        [...rows.values()].filter((item) => item.PK.startsWith('TOKEN#')),
      ).toHaveLength(2);
      return [
        {
          received: true,
          opened: true,
          folder: 'inbox' as const,
          spf: 'pass',
          dkim: 'pass',
          dmarc: 'pass',
        },
        {
          received: true,
          opened: true,
          folder: 'spam' as const,
          spf: 'pass',
          dkim: 'pass',
          dmarc: 'pass',
        },
      ];
    });
    const result = await runEmailAcceptance({
      manifest,
      outputs,
      jwt,
      adapter,
      wait,
      phase: 'recipients',
      recipients: ['one@example.test', 'two@other.test'],
      confirmRecipientEvidence: confirmation,
    });
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(result.realRecipients).toContain('confirmed');
    expect(rows.size + photos.size).toBe(0);
  });
});
