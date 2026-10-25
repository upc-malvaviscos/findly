import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  permissionInventory,
  verifyPermissionInventory,
} from '../../scripts/lib/deployment-permission-contract.mjs';
import { inventoryConfig } from '../../scripts/lib/terraform-permission-inventory.mjs';
import { productionDeploymentPolicies } from '../../scripts/lib/production-role-policies.mjs';
import {
  policyDecision,
  requireResourcePattern,
  resourcePatternCovered,
} from '../../scripts/lib/iam-policy-evaluation.mjs';

const tags = {
  Project: 'findly',
  Environment: 'production',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
  DataClass: 'biometric',
};
const arn = (service: string, path: string) =>
  `arn:aws:${service}:eu-west-1:123456789012:${path}`;
const roleArn = (name: string) => `arn:aws:iam::123456789012:role/${name}`;
const boundaryArn =
  'arn:aws:iam::123456789012:policy/findly-production-runtime-boundary';
function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('Missing fixture resource');
  return value;
}
const resource = (
  type: string,
  name: string,
  values: Record<string, unknown>,
) => ({
  address: `module.application.${type}.${name}`,
  type,
  mode: 'managed',
  values,
});
function graph() {
  const names: readonly [string, string] = [
    'findly-production-admin-delete_photo',
    'findly-production-registration-backfill-role',
  ];
  return {
    resources: [
      ...names.map((name, index) =>
        resource('aws_iam_role', `role${index}`, {
          name,
          arn: roleArn(name),
          permissions_boundary: boundaryArn,
          tags,
        }),
      ),
      resource('aws_lambda_function', 'admin', {
        function_name: names[0],
        role: roleArn(names[0]),
        tags,
      }),
      resource('aws_lambda_function', 'backfill', {
        function_name: 'findly-production-registration-backfill',
        role: roleArn(names[1]),
        tags,
      }),
      resource('aws_iam_role_policy', 'admin', {
        role: names[0],
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'dynamodb:BatchWriteItem',
              Resource: arn('dynamodb', 'table/findly-production'),
            },
          ],
        }),
      }),
      resource('aws_iam_role_policy', 'backfill', {
        role: names[1],
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:SendMessage',
              ],
              Resource: arn('sqs', 'findly-production-backfill-queue'),
            },
          ],
        }),
      }),
      resource('aws_sqs_queue', 'backfill', {
        name: 'findly-production-backfill-queue',
        arn: arn('sqs', 'findly-production-backfill-queue'),
        tags,
      }),
      resource('aws_lambda_event_source_mapping', 'backfill', {
        function_name: arn(
          'lambda',
          'function:findly-production-registration-backfill',
        ),
        event_source_arn: arn('sqs', 'findly-production-backfill-queue'),
        tags,
      }),
    ],
  };
}
const documents = () => productionDeploymentPolicies(inventoryConfig);
const verify = (root = graph(), docs = documents()) =>
  verifyPermissionInventory(
    permissionInventory(root, inventoryConfig),
    Object.values(docs.deploy),
    docs.boundary,
  );

describe('Terraform resource and runtime permission contract', () => {
  it('covers administration, backfill, role passing and both permission layers', () => {
    expect(verify()).toMatchObject({ resources: 8, runtimeCases: 4 });
  });
  it('rejects a newly inventoried function absent from deployment policies', () => {
    const root = graph();
    root.resources.push(
      resource('aws_lambda_function', 'new_handler', {
        function_name: 'findly-production-new-handler',
        role: roleArn('findly-production-admin-delete_photo'),
        tags,
      }),
    );
    expect(() => verify(root)).toThrow(/new_handler.*lambda:GetFunction/);
  });
  it('rejects a newly inventoried queue absent from deployment policies', () => {
    const root = graph();
    root.resources.push(
      resource('aws_sqs_queue', 'new_queue', {
        name: 'findly-production-new-queue',
        tags,
      }),
    );
    expect(() => verify(root)).toThrow(/new_queue.*sqs:CreateQueue/);
  });
  it('rejects missing BatchWriteItem even when every resource can be created', () => {
    const docs = documents();
    for (const statement of docs.boundary.Statement)
      statement.Action = [statement.Action]
        .flat()
        .filter((a) => a !== 'dynamodb:BatchWriteItem');
    expect(() => verify(graph(), docs)).toThrow(
      /runtime boundary.*BatchWriteItem/,
    );
  });
  it('rejects missing backfill queue access in the runtime boundary', () => {
    const docs = documents();
    for (const statement of docs.boundary.Statement)
      statement.Resource = [statement.Resource]
        .flat()
        .filter((r) => r !== arn('sqs', 'findly-production-backfill-queue'));
    expect(() => verify(graph(), docs)).toThrow(
      /runtime boundary.*sqs:ReceiveMessage/,
    );
  });
  it.each(['Project', 'Environment', 'ManagedBy', 'CostCenter', 'DataClass'])(
    'rejects missing ownership metadata %s',
    (key) => {
      const root = graph();
      const incomplete = { ...tags };
      Reflect.deleteProperty(incomplete, key);
      at(root.resources, 0).values.tags = incomplete;
      expect(() => verify(root)).toThrow();
    },
  );
  it('discovers unbounded roles without a hand-maintained module list', () => {
    const root = graph();
    at(root.resources, 0).values.permissions_boundary = null;
    expect(() => verify(root)).toThrow(/missing runtime boundary/);
  });
  it('fails closed for new unmodelled Terraform resource types', () => {
    const root = graph();
    root.resources.push(resource('aws_unknown_resource', 'new', {}));
    expect(() => verify(root)).toThrow(/unsupported Terraform resource type/);
  });
  it('rejects a mapping to another queue or another function', () => {
    for (const key of ['function_name', 'event_source_arn']) {
      const root = graph();
      at(root.resources, root.resources.length - 1).values[key] =
        'arn:aws:lambda:eu-west-1:123456789012:function:foreign';
      expect(() => verify(root)).toThrow(/foreign mapping/);
    }
  });
  it('preserves demo policy scope and creates no production destroy role', () => {
    const docs = documents();
    expect(docs).not.toHaveProperty('destroy');
    expect(JSON.stringify(docs)).not.toContain('findly-demo');
  });
});

describe('semantic IAM authorization, including negative contexts', () => {
  const docs = documents();
  const policies = Object.values(docs.deploy);
  it('permits BatchWriteItem only on the production table, excluding indexes and other namespaces', () => {
    const request = {
      action: 'dynamodb:BatchWriteItem',
      resource: arn('dynamodb', 'table/findly-production'),
    };
    expect(policyDecision([docs.boundary], request)).toBe('allowed');
    for (const resource of [
      arn('dynamodb', 'table/findly-production/index/GSI1'),
      arn('dynamodb', 'table/findly-demo'),
      'arn:aws:dynamodb:eu-west-1:999999999999:table/findly-production',
      'arn:aws:dynamodb:us-east-1:123456789012:table/findly-production',
    ])
      expect(policyDecision([docs.boundary], { ...request, resource })).toBe(
        'implicitDeny',
      );
  });
  it('limits backfill producer/consumer access to its queue, excluding its DLQ and other environments', () => {
    for (const action of [
      'sqs:SendMessage',
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
    ]) {
      expect(
        policyDecision([docs.boundary], {
          action,
          resource: arn('sqs', 'findly-production-backfill-queue'),
        }),
      ).toBe('allowed');
      for (const resource of [
        arn('sqs', 'findly-production-backfill-dlq'),
        arn('sqs', 'findly-demo-backfill-queue'),
        'arn:aws:sqs:eu-west-1:999999999999:findly-production-backfill-queue',
      ])
        expect(policyDecision([docs.boundary], { action, resource })).toBe(
          'implicitDeny',
        );
    }
  });
  const context = {
    'aws:RequestedRegion': 'eu-west-1',
    'aws:RequestTag/Project': 'findly',
    'aws:RequestTag/Environment': 'production',
  };
  const mapping = {
    action: 'lambda:CreateEventSourceMapping',
    resource: '*',
    context: {
      ...context,
      'lambda:FunctionArn': arn(
        'lambda',
        'function:findly-production-registration-backfill',
      ),
    },
  };
  it('allows the intended mapping, with region, ownership tags and function context', () => {
    expect(policyDecision(policies, mapping)).toBe('allowed');
  });
  it.each([
    ['aws:RequestedRegion', 'us-east-1'],
    ['aws:RequestTag/Environment', 'demo'],
    ['aws:RequestTag/Project', 'foreign'],
    ['lambda:FunctionArn', arn('lambda', 'function:foreign')],
  ])('rejects mapping context %s=%s', (key, value) => {
    expect(
      policyDecision(policies, {
        ...mapping,
        context: { ...mapping.context, [key]: value },
      }),
    ).toBe('implicitDeny');
  });
  it('rejects absent request tags', () => {
    expect(
      policyDecision(policies, {
        ...mapping,
        context: {
          'aws:RequestedRegion': 'eu-west-1',
          'lambda:FunctionArn': mapping.context['lambda:FunctionArn'],
        },
      }),
    ).toBe('implicitDeny');
  });
  it('requires an approved service for PassRole', () => {
    const request = {
      action: 'iam:PassRole',
      resource: roleArn('findly-production-registration-backfill-role'),
      context: { 'iam:PassedToService': 'lambda.amazonaws.com' },
    };
    expect(policyDecision(policies, request)).toBe('allowed');
    expect(
      policyDecision(policies, {
        ...request,
        context: { 'iam:PassedToService': 'ec2.amazonaws.com' },
      }),
    ).toBe('implicitDeny');
  });
  it('requires the boundary when creating roles and denies its removal', () => {
    const request = {
      action: 'iam:CreateRole',
      resource: roleArn('findly-production-registration-backfill-role'),
      context: { 'iam:PermissionsBoundary': boundaryArn },
    };
    expect(policyDecision(policies, request)).toBe('allowed');
    expect(policyDecision(policies, { ...request, context: {} })).toBe(
      'implicitDeny',
    );
    expect(
      policyDecision(policies, {
        ...request,
        action: 'iam:DeleteRolePermissionsBoundary',
      }),
    ).toBe('explicitDeny');
  });
  it('does not mistake requested tags for current CloudFront ownership', () => {
    const request = {
      action: 'cloudfront:TagResource',
      resource: 'arn:aws:cloudfront::123456789012:distribution/EEXAMPLE',
      context,
    };
    expect(policyDecision(policies, request)).toBe('implicitDeny');
    expect(
      policyDecision(policies, {
        ...request,
        context: {
          ...context,
          'aws:ResourceTag/Project': 'findly',
          'aws:ResourceTag/Environment': 'production',
        },
      }),
    ).toBe('allowed');
  });
  it('honours explicit deny over an allow', () => {
    expect(
      policyDecision(
        [
          {
            Version: '2012-10-17',
            Statement: [
              { Effect: 'Allow', Action: '*', Resource: '*' },
              { Effect: 'Deny', Action: 's3:*', Resource: '*' },
            ],
          },
        ],
        { action: 's3:GetObject', resource: 'arn:aws:s3:::example/key' },
      ),
    ).toBe('explicitDeny');
  });
  it('rejects unsupported condition operators instead of assuming authorization', () => {
    expect(() =>
      policyDecision(
        [
          {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: '*',
                Resource: '*',
                Condition: { StringEqualsIfExists: { key: 'value' } },
              },
            ],
          },
        ],
        { action: 's3:GetObject', resource: 'x' },
      ),
    ).toThrow(/Unsupported IAM condition/);
  });
  it('rejects policy variables and NotAction', () => {
    for (const statement of [
      { Effect: 'Allow', Action: '*', Resource: '${aws:username}' },
      {
        Effect: 'Allow',
        Action: '*',
        Resource: '*',
        Condition: { StringEquals: { 's3:prefix': '${aws:username}' } },
      },
      { Effect: 'Allow', NotAction: 'iam:*', Resource: '*' },
    ])
      expect(() =>
        policyDecision([{ Version: '2012-10-17', Statement: [statement] }], {
          action: 's3:GetObject',
          resource: 'x',
        }),
      ).toThrow();
  });
});

describe('full wildcard coverage rather than a single representative ARN', () => {
  it('keeps stars literal in StringEquals runtime conditions', () => {
    const root = graph();
    at(root.resources, 4).values.policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:ListBucket',
          Resource: `arn:aws:s3:::${inventoryConfig.uploadsBucket}`,
          Condition: { StringEquals: { 's3:prefix': 'events/*' } },
        },
      ],
    });
    const docs = documents();
    const statement = docs.boundary.Statement.find((s) =>
      [s.Action].flat().includes('s3:ListBucket'),
    );
    if (!statement) throw new Error('Missing ListBucket fixture permission');
    statement.Condition = { StringEquals: { 's3:prefix': 'events/contract' } };
    expect(() => verify(root, docs)).toThrow(/does not cover/);
    statement.Condition = { StringEquals: { 's3:prefix': 'events/*' } };
    expect(verify(root, docs).runtimeCases).toBe(4);
  });
  it.each([
    ['events/*', ['events/*'], [], true],
    ['events/*/photos/*', ['events/*'], [], true],
    ['events/*', ['events/contract'], [], false],
    ['events/*', ['events/*/photos/*'], [], false],
    ['photos/?', ['photos/a', 'photos/b'], [], false],
    ['photos/?', ['photos/*'], [], true],
    ['photos/*', ['photos/*'], ['photos/private/*'], false],
    ['a*', ['a', 'a?*'], [], true],
  ])('checks language inclusion for %s', (required, allow, deny, result) => {
    expect(resourcePatternCovered(required, allow, deny)).toBe(result);
  });
  it('rejects a narrowed condition even if it permits the representative prefix', () => {
    const boundary = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:ListBucket',
          Resource: 'arn:aws:s3:::example',
          Condition: { StringLike: { 's3:prefix': 'events/contract' } },
        },
      ],
    };
    expect(() =>
      requireResourcePattern(
        [boundary],
        {
          action: 's3:ListBucket',
          resource: 'arn:aws:s3:::example',
          context: { 's3:prefix': 'events/contract' },
          contextPatterns: { 's3:prefix': 'events/*' },
        },
        'runtime',
      ),
    ).toThrow(/does not cover/);
  });
});

it('keeps the permission preflight before apply, without continue-on-error or new workflows', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const preflight = workflow.indexOf(
    'node scripts/preflight-production-permissions.mjs',
  );
  expect(preflight).toBeGreaterThan(0);
  expect(preflight).toBeLessThan(
    workflow.indexOf('- name: Apply the exact reviewed run plan'),
  );
  expect(workflow).not.toContain('continue-on-error');
  expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain(
    'npm run permissions:check',
  );
});
