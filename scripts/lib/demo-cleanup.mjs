import assert from 'node:assert/strict';

export function requireDemoTags(tags) {
  const values = Array.isArray(tags)
    ? Object.fromEntries(tags.map((t) => [t.Key, t.Value]))
    : tags;
  assert.equal(values?.Project, 'findly', 'Live resource project mismatch');
  assert.equal(
    values?.Environment,
    'demo',
    'Live resource environment mismatch',
  );
  assert.equal(values?.ManagedBy, 'Terraform', 'Live resource owner mismatch');
  assert.equal(
    values?.CostCenter,
    'findly',
    'Live resource cost center mismatch',
  );
}

export async function emptyDemoBucket(aws, bucket, config) {
  assert(
    [config.uploadsBucket, config.webBucket].includes(bucket),
    'Refusing foreign bucket',
  );
  assert.notEqual(bucket, config.stateBucket, 'Refusing shared backend');
  requireDemoTags(
    aws('s3api', 'get-bucket-tagging', { Bucket: bucket }).TagSet,
  );
  const location = aws('s3api', 'get-bucket-location', { Bucket: bucket });
  assert.equal(
    location.LocationConstraint,
    config.region,
    'Live bucket region mismatch',
  );
  for (let attempt = 0; attempt < 10000; attempt++) {
    const versions = aws('s3api', 'list-object-versions', {
      Bucket: bucket,
      MaxKeys: 1000,
    });
    const objects = [
      ...(versions.Versions ?? []),
      ...(versions.DeleteMarkers ?? []),
    ].map(({ Key, VersionId }) => ({ Key, VersionId }));
    if (!objects.length) break;
    const result = aws('s3api', 'delete-objects', {
      Bucket: bucket,
      Delete: { Objects: objects, Quiet: true },
    });
    assert(
      !result.Errors?.length,
      'S3 version deletion failed; rerun after correcting permissions',
    );
    assert(attempt < 9999, 'Bucket cleanup exceeded its bound');
  }
  for (let attempt = 0; attempt < 10000; attempt++) {
    const objects =
      aws('s3api', 'list-objects-v2', { Bucket: bucket, MaxKeys: 1000 })
        .Contents ?? [];
    if (!objects.length) break;
    const result = aws('s3api', 'delete-objects', {
      Bucket: bucket,
      Delete: { Objects: objects.map(({ Key }) => ({ Key })), Quiet: true },
    });
    assert(!result.Errors?.length, 'S3 object deletion failed');
    assert(attempt < 9999, 'Bucket cleanup exceeded its bound');
  }
  for (let attempt = 0; attempt < 10000; attempt++) {
    const uploads =
      aws('s3api', 'list-multipart-uploads', {
        Bucket: bucket,
        MaxUploads: 1000,
      }).Uploads ?? [];
    if (!uploads.length) break;
    for (const { Key, UploadId } of uploads)
      aws('s3api', 'abort-multipart-upload', { Bucket: bucket, Key, UploadId });
    assert(attempt < 9999, 'Multipart cleanup exceeded its bound');
  }
}

export function demoCollectionIds(aws, config) {
  const ids = [];
  let token;
  do {
    const result = aws('rekognition', 'list-collections', {
      MaxResults: 100,
      ...(token && { NextToken: token }),
    });
    for (const id of result.CollectionIds ?? []) {
      if (!id.startsWith('findly-demo-event-')) continue;
      assert(
        /^findly-demo-event-[A-Za-z0-9_.-]+$/.test(id),
        'Invalid demo collection ID',
      );
      const arn = `arn:aws:rekognition:${config.region}:${config.account}:collection/${id}`;
      requireDemoTags(
        aws('rekognition', 'list-tags-for-resource', { ResourceArn: arn }).Tags,
      );
      ids.push(id);
    }
    token = result.NextToken;
  } while (token);
  return ids;
}

export async function quiesceDemo(aws, inventory, config, pause) {
  // Validate all live ownership before the first mutation.
  for (const bucket of inventory.buckets)
    requireDemoTags(
      aws('s3api', 'get-bucket-tagging', { Bucket: bucket }).TagSet,
    );
  for (const fn of inventory.functions) {
    const live = aws('lambda', 'get-function', { FunctionName: fn.name });
    requireDemoTags(live.Tags);
    assert.equal(live.Configuration.FunctionName, fn.name);
    assert.equal(live.Configuration.FunctionArn.split(':')[4], config.account);
  }
  for (const bucket of inventory.buckets) {
    // Revoke already-issued PUT capabilities, including in-flight multipart completion.
    // This exact temporary policy is removed with the bucket; it contains no data.
    aws('s3api', 'put-bucket-policy', {
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'ManualDemoDestroyStopWrites',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: `arn:aws:s3:::${bucket}/*`,
          },
        ],
      }),
    });
  }
  for (const schedule of inventory.schedules) {
    const current = aws('scheduler', 'get-schedule', {
      Name: schedule.name,
      GroupName: schedule.group,
    });
    assert.equal(current.Arn.split(':')[4], config.account);
    aws('scheduler', 'update-schedule', {
      Name: schedule.name,
      GroupName: schedule.group,
      State: 'DISABLED',
      ScheduleExpression: current.ScheduleExpression,
      ScheduleExpressionTimezone: current.ScheduleExpressionTimezone,
      FlexibleTimeWindow: current.FlexibleTimeWindow,
      Target: current.Target,
      ...(current.StartDate && { StartDate: current.StartDate }),
      ...(current.EndDate && { EndDate: current.EndDate }),
    });
  }
  for (const fn of inventory.functions)
    aws('lambda', 'put-function-concurrency', {
      FunctionName: fn.name,
      ReservedConcurrentExecutions: 0,
    });
  // Reserved concurrency stops new invocations; an already-running invocation may
  // continue for its configured timeout. Wait that bound before deleting data.
  const seconds =
    Math.max(0, ...inventory.functions.map((fn) => fn.timeout)) + 10;
  for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
    console.log(
      `Waiting for running demo functions to finish (${elapsed}/${seconds}s).`,
    );
    await pause(Math.min(30, seconds - elapsed) * 1000);
  }
}
