import { describe, expect, it, vi } from 'vitest';

const getSignedUrlMock = vi.hoisted(() =>
  vi
    .fn()
    .mockResolvedValue(
      'https://s3.example.com/events/evt-1/selfies/reg-1.jpg?signature=mock',
    ),
);
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { createPresignedUploadUrl } from '../../../src/lambdas/lib/presignedUpload';

describe('createPresignedUploadUrl', () => {
  it('signs a PUT for the given bucket, key and content type, expiring in 300s', async () => {
    const result = await createPresignedUploadUrl({
      bucket: 'findly-local-selfies',
      key: 'events/evt-1/selfies/reg-1.jpg',
      contentType: 'image/jpeg',
    });

    expect(result).toEqual({
      uploadUrl:
        'https://s3.example.com/events/evt-1/selfies/reg-1.jpg?signature=mock',
      expiresInSeconds: 300,
    });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
      { expiresIn: number },
    ];
    expect(command.input).toMatchObject({
      Bucket: 'findly-local-selfies',
      Key: 'events/evt-1/selfies/reg-1.jpg',
      ContentType: 'image/jpeg',
    });
    expect(options).toEqual({ expiresIn: 300 });
  });
});
