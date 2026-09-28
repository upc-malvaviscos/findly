import { describe, expect, it, vi } from 'vitest';

// Synthetic credentials exercise SigV4 locally without an AWS account.
vi.stubEnv('AWS_ACCESS_KEY_ID', 'SYNTHETICACCESSKEY');
vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'synthetic-test-key');
vi.stubEnv('AWS_SESSION_TOKEN', 'synthetic-session-token');
vi.stubEnv('AWS_ENDPOINT_URL', '');
vi.stubEnv('AWS_PROFILE', undefined);
vi.stubEnv('AWS_DEFAULT_PROFILE', undefined);

describe('real SDK upload signing', () => {
  it('binds JPEG Content-Type and object key with a five minute lifetime', async () => {
    const { createPresignedUploadUrl } =
      await import('../../../src/lambdas/lib/presignedUpload');
    const result = await createPresignedUploadUrl({
      bucket: 'findly-synthetic-signature-test',
      key: 'events/evt-synthetic/photos/photo-synthetic.jpg',
      contentType: 'image/jpeg',
    });
    const url = new URL(result.uploadUrl);
    expect(url.pathname).toBe(
      '/events/evt-synthetic/photos/photo-synthetic.jpg',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('cryptographically binds write-once for selfies and bounds expiry', async () => {
    const { createPresignedUploadUrl } =
      await import('../../../src/lambdas/lib/presignedUpload');
    const url = new URL(
      (
        await createPresignedUploadUrl({
          bucket: 'findly-synthetic-signature-test',
          key: 'events/synthetic/selfies/registration.selfie.jpg',
          contentType: 'image/jpeg',
          writeOnce: true,
          expiresInSeconds: 40,
        })
      ).uploadUrl,
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host;if-none-match',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('40');
    await expect(
      createPresignedUploadUrl({
        bucket: 'synthetic',
        key: 'synthetic',
        contentType: 'image/jpeg',
        expiresInSeconds: 301,
      }),
    ).rejects.toThrow('INVALID_UPLOAD_EXPIRY');
  });
});
