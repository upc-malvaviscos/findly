import { describe, expect, it } from 'vitest';
import {
  productionPlanResources,
  mockVariablesForPlan,
} from '../../scripts/lib/production-plan-inventory.mjs';
import {
  inventoryConfig,
  inventoryVariables,
} from '../../scripts/lib/terraform-permission-inventory.mjs';

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing fixture resource');
  return value;
}
const roleName = 'findly-production-registration-backfill-role';
const address = 'module.findly.aws_iam_role.backfill';
const role = {
  address,
  type: 'aws_iam_role',
  mode: 'managed',
  values: {
    name: roleName,
    arn: `arn:aws:iam::123456789012:role/${roleName}`,
    permissions_boundary:
      'arn:aws:iam::123456789012:policy/findly-production-runtime-boundary',
  },
};
function plan() {
  return {
    format_version: '1.2',
    errored: false,
    variables: Object.fromEntries(
      Object.entries(inventoryVariables).map(([key, value]) => [
        key,
        { value },
      ]),
    ),
    planned_values: {
      root_module: {
        resources: [
          {
            ...role,
            values: {
              name: roleName,
              permissions_boundary: role.values.permissions_boundary,
            },
          },
        ],
      },
    },
    resource_changes: [
      {
        address,
        mode: 'managed',
        change: { actions: ['create'], after_unknown: { arn: true } },
      },
    ],
  };
}
describe('new-resource computed values and reviewed production inputs', () => {
  it('resolves an unknown ARN from a fresh Terraform-derived template', () => {
    expect(
      productionPlanResources(
        plan(),
        { resources: [role] },
        inventoryConfig,
      ).resources.at(0)?.values.arn,
    ).toBe(role.values.arn);
  });
  it('keeps known plan inputs and refuses a foreign name', () => {
    const p = plan();
    first(p.planned_values.root_module.resources).values.name = 'foreign';
    expect(() =>
      productionPlanResources(p, { resources: [role] }, inventoryConfig),
    ).toThrow(/unreviewed name/);
  });
  it('rejects resources absent from the source graph rather than trusting a stale fixture', () => {
    expect(() =>
      productionPlanResources(plan(), { resources: [] }, inventoryConfig),
    ).toThrow(/not covered/);
  });
  it('fails on unresolved values absent from the generated template', () => {
    const p = plan();
    first(p.resource_changes).change.after_unknown = { arn: true };
    const { arn: omitted, ...values } = role.values;
    expect(omitted).toBeTruthy();
    expect(() =>
      productionPlanResources(
        p,
        { resources: [{ ...role, values }] },
        inventoryConfig,
      ),
    ).toThrow(/no Terraform-derived template/);
  });
  it('rejects a different region, project, bucket or sender', () => {
    for (const key of [
      'project',
      'aws_region',
      'uploads_bucket_name',
      'cognito_email_from_address',
    ]) {
      const p = plan();
      Reflect.set(p.variables, key, { value: 'foreign' });
      expect(() => mockVariablesForPlan(p, inventoryConfig)).toThrow(
        /unreviewed/,
      );
    }
  });
  it('rejects new root variables instead of persisting arbitrary data in a mock fixture', () => {
    const p = plan();
    Reflect.set(p.variables, 'unreviewed_input', { value: 'private-value' });
    expect(() => mockVariablesForPlan(p, inventoryConfig)).toThrow(
      /new root variable/,
    );
  });
  it('does not copy a private alert contact into mock test files or diagnostics', () => {
    const p = plan();
    Reflect.set(p.variables, 'alert_email', {
      value: 'private-contact@example.test',
    });
    let message = '';
    try {
      mockVariablesForPlan(p, inventoryConfig);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/alert subscription/);
    expect(message).not.toContain('private-contact');
  });
  it('rejects errored plans and unsupported JSON versions', () => {
    for (const patch of [{ errored: true }, { format_version: '2.0' }])
      expect(() =>
        productionPlanResources(
          { ...plan(), ...patch },
          { resources: [role] },
          inventoryConfig,
        ),
      ).toThrow();
  });
});
