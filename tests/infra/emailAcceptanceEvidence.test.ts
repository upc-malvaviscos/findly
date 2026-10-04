import { describe, expect, it } from 'vitest';
import {
  requireAcceptanceTimeBudget,
  hasSyntheticEvidence,
  recipientEvidence,
} from '../../scripts/lib/email-acceptance-evidence.mjs';
const startedAt = '2026-10-04T20:00:00Z';
const proof = {
  spf: 'pass',
  dkim: 'pass',
  dmarc: 'pass',
  folder: 'inbox',
  opened: true,
};
const comment = (body: string, login = 'anyulled', created_at = startedAt) => ({
  body,
  user: { login },
  created_at,
});
describe('public receipt evidence provenance', () => {
  it('requires a trusted actor, exact synthetic marker and new timestamp', () => {
    const body = 'FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC:123';
    expect(hasSyntheticEvidence([comment(body)], '123', startedAt)).toBe(true);
    expect(
      hasSyntheticEvidence([comment(body, 'attacker')], '123', startedAt),
    ).toBe(false);
    expect(
      hasSyntheticEvidence(
        [comment(body, 'anyulled', '2026-10-03T20:00:00Z')],
        '123',
        startedAt,
      ),
    ).toBe(false);
    expect(
      hasSyntheticEvidence([comment(`${body}\nextra`)], '123', startedAt),
    ).toBe(false);
  });
  it('accepts two complete provider proofs without personal data', () => {
    const comments = ['A', 'B'].map((provider) =>
      comment(
        `FINDLY_EMAIL_ACCEPTANCE_RECEIPT:123:${provider} ${JSON.stringify(proof)}`,
      ),
    );
    expect(Object.keys(recipientEvidence(comments, '123', startedAt))).toEqual([
      'A',
      'B',
    ]);
  });
  it.each([
    { ...proof, opened: false },
    { ...proof, spf: 'fail' },
    { ...proof, dkim: undefined },
    { ...proof, folder: 'unknown' },
    { ...proof, email: 'private@example.test' },
  ])('rejects incomplete or excessive receipt data', (invalid) => {
    expect(
      recipientEvidence(
        [
          comment(
            `FINDLY_EMAIL_ACCEPTANCE_RECEIPT:123:A ${JSON.stringify(invalid)}`,
          ),
        ],
        '123',
        startedAt,
      ),
    ).toEqual({});
  });
  it('rejects foreign run, old timestamp, fake actor and invalid JSON', () => {
    const body = `FINDLY_EMAIL_ACCEPTANCE_RECEIPT:123:A ${JSON.stringify(proof)}`;
    expect(
      recipientEvidence(
        [
          comment(body, 'attacker'),
          comment(body, 'anyulled', 'invalid'),
          comment(body.replace(':123:', ':124:')),
          comment('FINDLY_EMAIL_ACCEPTANCE_RECEIPT:123:A {broken}'),
        ],
        '123',
        startedAt,
      ),
    ).toEqual({});
  });
});

describe('acceptance manifest cleanup reserve', () => {
  const now = Date.parse(startedAt);
  it('requires 65 minutes of remaining validity before credentials', () => {
    expect(() =>
      requireAcceptanceTimeBudget(
        { expiresAt: new Date(now + 65 * 60 * 1000).toISOString() },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      requireAcceptanceTimeBudget(
        { expiresAt: new Date(now + 65 * 60 * 1000 - 1).toISOString() },
        now,
      ),
    ).toThrow();
    expect(() =>
      requireAcceptanceTimeBudget(
        { expiresAt: new Date(now + 60 * 1000).toISOString() },
        now,
      ),
    ).toThrow();
    expect(() =>
      requireAcceptanceTimeBudget({ expiresAt: 'invalid' }, now),
    ).toThrow();
  });
});

// Mocked transport checks validate privacy; they do not demonstrate deployed AWS.
describe('reviewed SDK transport', () => {
  it('rejects operations outside the acceptance allowlist before network access', async () => {
    const { createAcceptanceAws, acceptanceAwsCommand } =
      await import('../../scripts/lib/email-acceptance-aws.mjs');
    expect(() => acceptanceAwsCommand('iam', 'create-role')).toThrow(
      'Unreviewed',
    );
    expect(() => acceptanceAwsCommand('sqs', 'purge-queue')).toThrow(
      'Unreviewed',
    );
    await expect(
      createAcceptanceAws()('sesv2', 'send-email', {}),
    ).rejects.toThrow('Unreviewed');
  });
  it('keeps sensitive SDK errors out of the public error', async () => {
    const { mockClient } = await import('aws-sdk-client-mock');
    const { STSClient, GetCallerIdentityCommand } =
      await import('@aws-sdk/client-sts');
    const { createAcceptanceAws } =
      await import('../../scripts/lib/email-acceptance-aws.mjs');
    const mocked = mockClient(STSClient);
    mocked.on(GetCallerIdentityCommand).rejects(
      Object.assign(new Error('private-token-and-address'), {
        name: 'AccessDeniedException',
      }),
    );
    try {
      await expect(
        createAcceptanceAws()('sts', 'get-caller-identity', {}),
      ).rejects.toMatchObject({
        message: 'Acceptance AWS operation failed: sts:get-caller-identity',
        code: 'AccessDeniedException',
      });
    } finally {
      mocked.restore();
    }
  });
});
