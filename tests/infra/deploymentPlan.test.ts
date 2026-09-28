import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function validate(resource: Record<string, unknown>) {
  return spawnSync(process.execPath, ['scripts/check-deployment-plan.mjs'], {
    input: JSON.stringify({ resource_changes: [resource] }),
    encoding: 'utf8',
  });
}
describe('deployment plan gate', () => {
  it('allows in-place updates preserving serverless resources', () => {
    expect(
      validate({
        address: 'module.findly.lambda',
        mode: 'managed',
        type: 'aws_lambda_function',
        change: { actions: ['update'] },
      }).status,
    ).toBe(0);
  });
  it.each([['delete'], ['delete', 'create'], ['create', 'delete']])(
    'rejects deletion/replacement %j',
    (...actions) => {
      expect(
        validate({
          address: 'module.findly.bucket',
          mode: 'managed',
          type: 'aws_s3_bucket',
          change: { actions },
        }).status,
      ).toBe(1);
    },
  );
  it('rejects fixed-cost provisioning', () => {
    expect(
      validate({
        address: 'module.findly.rds',
        mode: 'managed',
        type: 'aws_db_instance',
        change: { actions: ['create'] },
      }).status,
    ).toBe(1);
  });
});
