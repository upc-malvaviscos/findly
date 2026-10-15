import { describe, expect, it, vi } from 'vitest';
import type { FilterLogEventsCommandInput } from '@aws-sdk/client-cloudwatch-logs';
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
const fixture = manifest.fixtures.find((item) => item.scenario === 'api');
if (!fixture) throw new Error('API acceptance fixture is required');
const photoKey = fixture.photoKey;
const bucket = `findly-production-uploads-${manifest.account}-eu-west-1`;

function adapterFor(contents: Array<{ Key: string }> = []) {
  const aws = vi.fn(
    async (
      service: string,
      action: string,
      input: unknown,
    ): Promise<Record<string, unknown>> => {
      expect(service).toBe('s3api');
      expect(action).toBe('list-objects-v2');
      expect(input).toEqual({
        Bucket: bucket,
        Prefix: photoKey,
        MaxKeys: 1,
        ExpectedBucketOwner: manifest.account,
      });
      return { Contents: contents };
    },
  );
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

describe('acceptance matcher consumption evidence', () => {
  it('uses the SDK CloudWatch Logs field names and returns only presence', async () => {
    const { adapter, aws } = adapterFor();
    const expected: FilterLogEventsCommandInput = {
      logGroupName: '/aws/lambda/findly-production-photo-matcher',
      startTime: Date.parse(manifest.createdAt) - 60000,
      filterPattern: `{ $.event = "photo_processed" && $.eventId = "${fixture.eventId}" && $.photoId = "${fixture.photoId}" }`,
      limit: 1,
    };
    aws.mockImplementationOnce(async (service, action, input) => {
      expect(service).toBe('logs');
      expect(action).toBe('filter-log-events');
      expect(input).toEqual(expected);
      return { events: [{ message: 'private log body must not escape' }] };
    });
    await expect(
      adapter.photoProcessed(fixture.eventId, fixture.photoId),
    ).resolves.toBe(true);
  });
  it('waits when the reviewed log event is not available', async () => {
    const { adapter, aws } = adapterFor();
    aws.mockResolvedValueOnce({ events: [] });
    await expect(
      adapter.photoProcessed(fixture.eventId, fixture.photoId),
    ).resolves.toBe(false);
  });
  it('does not mask a log permission failure as pending consumption', async () => {
    const { adapter, aws } = adapterFor();
    aws.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(
      adapter.photoProcessed(fixture.eventId, fixture.photoId),
    ).rejects.toThrow();
  });
});
