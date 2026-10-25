import { describe, expect, it } from 'vitest';
import {
  appliedProductionPolicies,
  decodePolicyDocument,
} from '../../scripts/lib/applied-production-policies.mjs';
import { productionDeploymentPolicies } from '../../scripts/lib/production-role-policies.mjs';
import { partitionManagedPolicies } from '../../scripts/lib/demo-role-policies.mjs';
import {
  inventoryConfig,
  inventoryVariables,
} from '../../scripts/lib/terraform-permission-inventory.mjs';
import { productionPermissionPreflight } from '../../scripts/lib/production-permission-preflight.mjs';

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing fixture resource');
  return value;
}
const documents = productionDeploymentPolicies(inventoryConfig);
const parts = partitionManagedPolicies(documents.deploy);
const prefix = 'arn:aws:iam::123456789012:policy/';
const roleArn = 'arn:aws:iam::123456789012:role/findly-production-deploy';
function adapter(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const aws = (
    service: string,
    command: string,
    input: Record<string, unknown> = {},
  ) => {
    calls.push(`${service}:${command}`);
    if (Object.hasOwn(overrides, command)) return overrides[command];
    switch (command) {
      case 'get-caller-identity':
        return {
          Account: '123456789012',
          Arn: 'arn:aws:sts::123456789012:assumed-role/findly-production-deploy/review',
        };
      case 'get-role':
        return {
          Role: {
            Arn: roleArn,
            Tags: [
              { Key: 'Project', Value: 'findly' },
              { Key: 'Environment', Value: 'production' },
            ],
          },
        };
      case 'list-attached-role-policies':
        return input.Marker
          ? {
              AttachedPolicies: parts.slice(1).map((_, index) => ({
                PolicyArn: `${prefix}findly-production-deploy-${index + 2}`,
              })),
              IsTruncated: false,
            }
          : {
              AttachedPolicies: [
                { PolicyArn: `${prefix}findly-production-deploy-1` },
              ],
              IsTruncated: true,
              Marker: 'next',
            };
      case 'list-role-policies':
        return { PolicyNames: [], IsTruncated: false };
      case 'get-policy':
        return { Policy: { Arn: input.PolicyArn, DefaultVersionId: 'v3' } };
      case 'get-policy-version': {
        expect(input.VersionId).toBe('v3');
        const policy =
          input.PolicyArn === `${prefix}findly-production-runtime-boundary`
            ? documents.boundary
            : parts[Number(String(input.PolicyArn).split('-').at(-1)) - 1];
        return {
          PolicyVersion: {
            Document: encodeURIComponent(JSON.stringify(policy)),
          },
        };
      }
      default:
        throw new Error(`Unexpected AWS operation ${command}`);
    }
  };
  return { aws, calls };
}
describe('applied IAM evidence is read independently of generated documents', () => {
  it('reads every attached page and current policy version, and the runtime boundary', () => {
    const { aws, calls } = adapter();
    const result = appliedProductionPolicies(aws, inventoryConfig);
    expect(result.deploy).toEqual(parts);
    expect(result.runtimeBoundary).toEqual(documents.boundary);
    expect(
      calls.filter((c) => c === 'iam:list-attached-role-policies'),
    ).toHaveLength(2);
    expect(calls.every((c) => /:(get-|list-)/.test(c))).toBe(true);
  });
  it('loads inline policies as well as managed policies', () => {
    const policy = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Deny', Action: 'sqs:CreateQueue', Resource: '*' }],
    };
    const { aws } = adapter({
      'list-role-policies': { PolicyNames: ['restriction'] },
      'get-role-policy': { PolicyDocument: policy },
    });
    expect(
      appliedProductionPolicies(aws, inventoryConfig).deploy.at(-1),
    ).toEqual(policy);
  });
  it('fails closed when policy reads are denied', () => {
    const { aws, calls } = adapter();
    expect(() =>
      appliedProductionPolicies(
        (
          service: string,
          command: string,
          input: Record<string, unknown> = {},
        ) => {
          if (command === 'get-policy-version') throw new Error('AccessDenied');
          return aws(service, command, input);
        },
        inventoryConfig,
      ),
    ).toThrow(/AccessDenied/);
    expect(calls.every((c) => /:(get-|list-)/.test(c))).toBe(true);
  });
  it('refuses a root identity or another assumed role before reading IAM', () => {
    for (const Arn of [
      'arn:aws:iam::123456789012:root',
      'arn:aws:sts::123456789012:assumed-role/foreign/review',
    ]) {
      const { aws, calls } = adapter({
        'get-caller-identity': { Account: '123456789012', Arn },
      });
      expect(() => appliedProductionPolicies(aws, inventoryConfig)).toThrow(
        /production deployment role/,
      );
      expect(calls).toEqual(['sts:get-caller-identity']);
    }
  });
  it('refuses foreign account and foreign role ownership', () => {
    const { aws } = adapter({
      'get-caller-identity': { Account: '999999999999', Arn: 'foreign' },
    });
    expect(() => appliedProductionPolicies(aws, inventoryConfig)).toThrow(
      /wrong AWS account/,
    );
    const foreign = adapter({
      'get-role': {
        Role: {
          Arn: roleArn,
          Tags: [
            { Key: 'Project', Value: 'foreign' },
            { Key: 'Environment', Value: 'production' },
          ],
        },
      },
    });
    expect(() =>
      appliedProductionPolicies(foreign.aws, inventoryConfig),
    ).toThrow(/ownership/);
  });
  it('rejects attached policies outside the reviewed namespace', () => {
    const { aws } = adapter({
      'list-attached-role-policies': {
        AttachedPolicies: [
          { PolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' },
        ],
      },
    });
    expect(() => appliedProductionPolicies(aws, inventoryConfig)).toThrow(
      /unreviewed managed policy/,
    );
  });
  it('rejects incomplete and repeated pagination tokens', () => {
    for (const page of [
      { AttachedPolicies: [], IsTruncated: true },
      { AttachedPolicies: [], IsTruncated: true, Marker: 'again' },
    ]) {
      const { aws } = adapter({ 'list-attached-role-policies': page });
      expect(() => appliedProductionPolicies(aws, inventoryConfig)).toThrow(
        /pagination/,
      );
    }
  });
  it('does not silently ignore an unsupported applied condition', () => {
    expect(() =>
      decodePolicyDocument({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: '*',
            Resource: '*',
            Condition: { Null: { key: 'false' } },
          },
        ],
      }),
    ).toThrow(/Unsupported IAM condition/);
  });
});

describe('preflight composes source, plan and applied policies before permitting apply', () => {
  function fixture() {
    const name = 'findly-production-admin-delete_photo';
    const root = {
      resources: [
        {
          address: 'module.admin.aws_iam_role.function',
          type: 'aws_iam_role',
          mode: 'managed',
          values: {
            name,
            arn: `arn:aws:iam::123456789012:role/${name}`,
            permissions_boundary: documents.boundaryArn,
            tags: {
              Project: 'findly',
              Environment: 'production',
              ManagedBy: 'Terraform',
              CostCenter: 'findly',
              DataClass: 'biometric',
            },
          },
        },
        {
          address: 'module.admin.aws_iam_role_policy.function',
          type: 'aws_iam_role_policy',
          mode: 'managed',
          values: {
            role: name,
            policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'dynamodb:BatchWriteItem',
                  Resource:
                    'arn:aws:dynamodb:eu-west-1:123456789012:table/findly-production',
                },
              ],
            }),
          },
        },
      ],
    };
    const plan = {
      format_version: '1.2',
      variables: Object.fromEntries(
        Object.entries(inventoryVariables).map(([key, value]) => [
          key,
          { value },
        ]),
      ),
      planned_values: { root_module: structuredClone(root) },
      resource_changes: root.resources.map((r) => ({
        address: r.address,
        mode: 'managed',
        change: { actions: ['create'], after_unknown: {} },
      })),
    };
    return { plan, root };
  }
  it('passes the whole preflight with a read-only fake AWS adapter', () => {
    const { aws, calls } = adapter();
    const { plan, root } = fixture();
    expect(
      productionPermissionPreflight(plan, root, inventoryConfig, aws)
        .runtimeCases,
    ).toBe(1);
    expect(calls.every((c) => /:(get-|list-)/.test(c))).toBe(true);
  });
  it('blocks despite valid generated policies when the applied boundary is stale', () => {
    const { aws } = adapter();
    const { plan, root } = fixture();
    const stale = structuredClone(documents.boundary);
    for (const s of stale.Statement)
      s.Action = [s.Action]
        .flat()
        .filter((a) => a !== 'dynamodb:BatchWriteItem');
    expect(() =>
      productionPermissionPreflight(
        plan,
        root,
        inventoryConfig,
        (
          service: string,
          command: string,
          input: Record<string, unknown> = {},
        ) =>
          command === 'get-policy-version' &&
          input.PolicyArn === documents.boundaryArn
            ? { PolicyVersion: { Document: stale } }
            : aws(service, command, input),
      ),
    ).toThrow(/blocked apply.*BatchWriteItem/);
  });
  it('blocks on an applied deploy boundary as well as its attached policies', () => {
    const { aws } = adapter({
      'get-role': {
        Role: {
          Arn: roleArn,
          Tags: [
            { Key: 'Project', Value: 'findly' },
            { Key: 'Environment', Value: 'production' },
          ],
          PermissionsBoundary: {
            PermissionsBoundaryArn: documents.boundaryArn,
          },
        },
      },
    });
    const { plan, root } = fixture();
    expect(() =>
      productionPermissionPreflight(plan, root, inventoryConfig, aws),
    ).toThrow(/deploy boundary/);
  });
  it('never treats desired tags as current ownership of a foreign resource', () => {
    const { aws, calls } = adapter();
    const { plan, root } = fixture();
    Reflect.set(first(plan.resource_changes).change, 'before', {
      ...first(root.resources).values,
      tags: { Project: 'foreign', Environment: 'production' },
    });
    expect(() =>
      productionPermissionPreflight(plan, root, inventoryConfig, aws),
    ).toThrow(/current ownership/);
    expect(calls).toEqual([]);
  });
  it('rejects source mismatches before requesting AWS credentials or IAM reads', () => {
    const { aws, calls } = adapter();
    const { plan, root } = fixture();
    first(plan.planned_values.root_module.resources).values.name = 'foreign';
    expect(() =>
      productionPermissionPreflight(plan, root, inventoryConfig, aws),
    ).toThrow(/unreviewed name/);
    expect(calls).toEqual([]);
  });
});
