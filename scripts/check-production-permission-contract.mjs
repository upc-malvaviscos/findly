import {
  terraformPermissionState,
  inventoryConfig,
  inventoryVariables,
  flattenResources,
} from './lib/terraform-permission-inventory.mjs';
import {
  permissionInventory,
  verifyPermissionInventory,
} from './lib/deployment-permission-contract.mjs';
import { productionDeploymentPolicies } from './lib/production-role-policies.mjs';
import assert from 'node:assert/strict';
import { productionPlanResources } from './lib/production-plan-inventory.mjs';
import { productionPermissionPreflight } from './lib/production-permission-preflight.mjs';
import { partitionManagedPolicies } from './lib/demo-role-policies.mjs';

const state = terraformPermissionState();
const inventory = permissionInventory(state.root_module, inventoryConfig);
const documents = productionDeploymentPolicies(
  inventoryConfig,
  inventory.bindings,
);
const result = verifyPermissionInventory(
  inventory,
  Object.values(documents.deploy),
  documents.boundary,
);

// Exercise the plan adapter against the whole Terraform graph, including
// values that are unknown before the first real creation of a role/function.
const root = structuredClone(state.root_module);
const changes = flattenResources(root).map((resource) => {
  const unknown = {};
  const key = {
    aws_iam_role: 'arn',
    aws_lambda_function: 'role',
    aws_iam_role_policy: 'policy',
  }[resource.type];
  if (key) {
    delete resource.values[key];
    unknown[key] = true;
  }
  return {
    address: resource.address,
    mode: 'managed',
    change: { actions: ['create'], after_unknown: unknown },
  };
});
const syntheticPlan = {
  format_version: '1.2',
  variables: Object.fromEntries(
    Object.entries(inventoryVariables).map(([key, value]) => [key, { value }]),
  ),
  planned_values: { root_module: root },
  resource_changes: changes,
};
const adapted = productionPlanResources(
  syntheticPlan,
  state.root_module,
  inventoryConfig,
);
const resolved = permissionInventory(
  { resources: adapted.resources },
  inventoryConfig,
);
assert.deepEqual(
  verifyPermissionInventory(
    resolved,
    Object.values(documents.deploy),
    documents.boundary,
  ),
  result,
);

const parts = partitionManagedPolicies(documents.deploy);
const policyPrefix = 'arn:aws:iam::123456789012:policy/';
const fakeAws = (service, command, input = {}) => {
  assert(
    service === 'sts' || service === 'iam',
    'Unexpected preflight service',
  );
  switch (command) {
    case 'get-caller-identity':
      return {
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/findly-production-deploy/synthetic',
      };
    case 'get-role':
      return {
        Role: {
          Arn: 'arn:aws:iam::123456789012:role/findly-production-deploy',
          Tags: [
            { Key: 'Project', Value: 'findly' },
            { Key: 'Environment', Value: 'production' },
          ],
        },
      };
    case 'list-attached-role-policies':
      return {
        AttachedPolicies: parts.map((_, index) => ({
          PolicyArn: `${policyPrefix}findly-production-deploy-${index + 1}`,
        })),
      };
    case 'list-role-policies':
      return { PolicyNames: [] };
    case 'get-policy':
      return { Policy: { Arn: input.PolicyArn, DefaultVersionId: 'v1' } };
    case 'get-policy-version':
      return {
        PolicyVersion: {
          Document:
            input.PolicyArn === documents.boundaryArn
              ? documents.boundary
              : parts[Number(input.PolicyArn.split('-').at(-1)) - 1],
        },
      };
    default:
      throw new Error('Unexpected preflight operation');
  }
};
const creating = productionPermissionPreflight(
  syntheticPlan,
  state.root_module,
  inventoryConfig,
  fakeAws,
);
assert.equal(creating.runtimeCases, result.runtimeCases);
const existingPlan = structuredClone(syntheticPlan);
existingPlan.planned_values.root_module = structuredClone(state.root_module);
const existing = new Map(
  flattenResources(state.root_module).map((resource) => [
    resource.address,
    resource.values,
  ]),
);
for (const change of existingPlan.resource_changes)
  change.change = {
    actions: ['no-op'],
    before: existing.get(change.address),
    after_unknown: {},
  };
assert.deepEqual(
  productionPermissionPreflight(
    existingPlan,
    state.root_module,
    inventoryConfig,
    fakeAws,
  ),
  result,
);
console.log(
  `Terraform-derived permission contract passed: ${result.resources} resources, ${result.deploymentCases} deployment cases, ${result.runtimeCases} runtime cases. Mock provider only; applied IAM and AWS operation are not verified.`,
);
