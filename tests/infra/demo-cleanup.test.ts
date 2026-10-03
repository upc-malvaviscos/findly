import { describe, expect, it, vi } from 'vitest';
import {
  demoCollectionIds,
  emptyDemoBucket,
  quiesceDemo,
} from '../../scripts/lib/demo-cleanup.mjs';

const config = {
  account: '123456789012',
  region: 'eu-west-1',
  stateBucket: 'state',
  uploadsBucket: 'uploads',
  webBucket: 'web',
};
const tags = {
  Project: 'findly',
  Environment: 'demo',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
};
const tagSet = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

describe('manual demo cleanup', () => {
  it('removes versions, delete markers, current objects and multipart uploads across batches', async () => {
    let versions = 0;
    let objects = 0;
    let uploads = 0;
    const aws = vi.fn((_service: string, operation: string) => {
      if (operation === 'get-bucket-tagging') return { TagSet: tagSet };
      if (operation === 'get-bucket-location')
        return { LocationConstraint: 'eu-west-1' };
      if (operation === 'list-object-versions')
        return versions++ < 2
          ? {
              Versions: [{ Key: 'photo', VersionId: 'v' }],
              DeleteMarkers: [{ Key: 'photo', VersionId: 'marker' }],
            }
          : {};
      if (operation === 'list-objects-v2')
        return objects++ === 0 ? { Contents: [{ Key: 'photo' }] } : {};
      if (operation === 'list-multipart-uploads')
        return uploads++ === 0
          ? { Uploads: [{ Key: 'photo', UploadId: 'u' }] }
          : {};
      return {};
    });
    await emptyDemoBucket(aws, 'uploads', config);
    expect(
      aws.mock.calls.filter((c) => c[1] === 'delete-objects'),
    ).toHaveLength(3);
    expect(aws.mock.calls.some((c) => c[1] === 'abort-multipart-upload')).toBe(
      true,
    );
  });
  it('refuses foreign ownership before mutation', async () => {
    const aws = vi.fn(() => ({
      TagSet: [{ Key: 'Environment', Value: 'sandbox' }],
    }));
    await expect(emptyDemoBucket(aws, 'uploads', config)).rejects.toThrow();
    expect(aws).toHaveBeenCalledTimes(1);
    await expect(emptyDemoBucket(aws, 'state', config)).rejects.toThrow();
    expect(aws).toHaveBeenCalledTimes(1);
  });
  it('fails on per-object errors and succeeds when rerun after a partial cleanup', async () => {
    let fail = true;
    const aws = vi.fn((_service: string, operation: string) => {
      if (operation === 'get-bucket-tagging') return { TagSet: tagSet };
      if (operation === 'get-bucket-location')
        return { LocationConstraint: 'eu-west-1' };
      if (operation === 'list-object-versions')
        return fail ? { Versions: [{ Key: 'photo', VersionId: 'v' }] } : {};
      if (operation === 'delete-objects')
        return { Errors: [{ Code: 'AccessDenied' }] };
      return {};
    });
    await expect(emptyDemoBucket(aws, 'uploads', config)).rejects.toThrow(
      'version deletion',
    );
    fail = false;
    await expect(
      emptyDemoBucket(aws, 'uploads', config),
    ).resolves.toBeUndefined();
  });
  it('filters collections by namespace and verifies tags across pagination', () => {
    const aws = vi.fn(
      (_service: string, operation: string, input: { NextToken?: string }) => {
        if (operation === 'list-tags-for-resource') return { Tags: tags };
        return input.NextToken
          ? { CollectionIds: ['findly-demo-event-second'] }
          : {
              CollectionIds: [
                'findly-pr-90-event-x',
                'findly-demo-event-first',
              ],
              NextToken: 'next',
            };
      },
    );
    expect(demoCollectionIds(aws, config)).toEqual([
      'findly-demo-event-first',
      'findly-demo-event-second',
    ]);
  });
  it('revokes writes and pauses functions before waiting their full timeout', async () => {
    const aws = vi.fn((_service: string, operation: string) => {
      if (operation === 'get-bucket-tagging') return { TagSet: tagSet };
      if (operation === 'get-function')
        return {
          Tags: tags,
          Configuration: {
            FunctionName: 'findly-demo-retention-purger',
            FunctionArn:
              'arn:aws:lambda:eu-west-1:123456789012:function:findly-demo-retention-purger',
          },
        };
      return {};
    });
    const pause = vi.fn(async (milliseconds: number) => {
      expect(milliseconds).toBeGreaterThan(0);
    });
    await quiesceDemo(
      aws,
      {
        buckets: ['uploads'],
        schedules: [],
        functions: [{ name: 'findly-demo-retention-purger', timeout: 300 }],
      },
      config,
      pause,
    );
    expect(
      pause.mock.calls.reduce((sum, args) => sum + Number(args[0]), 0),
    ).toBe(310000);
    const operations = aws.mock.calls.map((c) => c[1]);
    expect(operations.indexOf('put-bucket-policy')).toBeLessThan(
      operations.indexOf('put-function-concurrency'),
    );
  });
});
