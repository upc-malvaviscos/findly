import { describe, expect, it, vi } from 'vitest';
import { createEmailAcceptanceManifest } from '../../scripts/lib/email-acceptance-manifest.mjs';
import { acceptanceAwsCommand } from '../../scripts/lib/email-acceptance-aws.mjs';
import type { EmailAcceptanceAdapter } from '../../scripts/lib/email-acceptance-harness.mjs';

const modulePath = '../../scripts/test-gallery-email-aws.mjs';
const production: {
  createEmailAcceptanceAwsAdapter(
    options: Record<string, unknown>,
  ): EmailAcceptanceAdapter;
} = await import(modulePath);
const manifest = createEmailAcceptanceManifest();
const photoKey = manifest.fixtures[0].photoKey;
const bucket = `findly-production-uploads-${manifest.account}-eu-west-1`;

function adapterFor(contents: Array<{ Key: string }> = []) {
  const aws = vi.fn(async (service: string, action: string, input: unknown) => {
    expect(service).toBe('s3api');
    expect(action).toBe('list-objects-v2');
    expect(input).toEqual({
      Bucket: bucket,
      Prefix: photoKey,
      MaxKeys: 1,
      ExpectedBucketOwner: manifest.account,
    });
    return { Contents: contents };
  });
  const adapter = production.createEmailAcceptanceAwsAdapter({
    manifest,
    outputs: {
      uploads_bucket_name: { value: bucket },
      api_endpoint: {
        value: 'https://synthetic.execute-api.eu-west-1.amazonaws.com/',
      },
    },
    jwt: 'synthetic',
    aws,
    credentials: {
      accessKeyId: 'synthetic',
      secretAccessKey: 'synthetic',
      sessionToken: 'synthetic',
    },
  });
  return { adapter, aws };
}

describe('acceptance photo existence with prefix-scoped S3 access', () => {
  it('can establish absence without an unrestricted bucket listing or HEAD', async () => {
    const { adapter, aws } = adapterFor();
    await expect(adapter.photoExists(photoKey)).resolves.toBe(false);
    expect(aws).toHaveBeenCalledTimes(1);
  });
  it('finds an existing exact key', async () => {
    await expect(
      adapterFor([{ Key: photoKey }]).adapter.photoExists(photoKey),
    ).resolves.toBe(true);
  });
  it('does not mistake a neighboring key for the photo', async () => {
    await expect(
      adapterFor([{ Key: `${photoKey}.other` }]).adapter.photoExists(photoKey),
    ).resolves.toBe(false);
  });
  it('does not treat permission failure as absence', async () => {
    const { adapter, aws } = adapterFor();
    aws.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(adapter.photoExists(photoKey)).rejects.toThrow();
  });
  it('resolves the reviewed list operation to the SDK command', () => {
    expect(acceptanceAwsCommand('s3api', 'list-objects-v2').name).toBe(
      'ListObjectsV2Command',
    );
  });
});
