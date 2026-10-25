import { productionPlanResources } from './production-plan-inventory.mjs';
import {
  permissionInventory,
  verifyPermissionInventory,
} from './deployment-permission-contract.mjs';
import { productionDeploymentPolicies } from './production-role-policies.mjs';
import { appliedProductionPolicies } from './applied-production-policies.mjs';
import assert from 'node:assert/strict';

export function productionPermissionPreflight(plan, mockedRoot, config, aws) {
  const { resources, changes } = productionPlanResources(
    plan,
    mockedRoot,
    config,
  );
  const inventory = permissionInventory({ resources }, config);
  const tagged = (value) => ({
    ...(value?.tags ?? {}),
    ...(value?.tags_all ?? {}),
  });
  for (const resource of resources) {
    const before = changes.get(resource.address)?.before;
    if (before && Object.keys(tagged(resource.values)).length) {
      const current = tagged(before);
      assert(
        current.Project === 'findly' && current.Environment === 'production',
        `${resource.address}: current ownership is not production; requested tags cannot establish ownership`,
      );
    }
  }
  inventory.requests = inventory.requests
    .filter(
      (request) =>
        changes.has(request.source) &&
        !(
          request.action === 'cloudfront:UpdateOriginAccessControl' &&
          changes.get(request.source).actions.includes('create')
        ),
    )
    .map((request) => {
      const context = { ...request.context };
      // ResourceTag is the CURRENT owner, never the desired tags from the plan.
      for (const key of Object.keys(context))
        if (key.startsWith('aws:ResourceTag/')) delete context[key];
      const owner = resources.find(
        (resource) => resource.address === request.ownershipSource,
      );
      const change = changes.get(request.ownershipSource);
      const value =
        change?.before ??
        (change?.actions.includes('create') ? owner?.values : undefined);
      for (const [key, tag] of Object.entries(tagged(value)))
        context[`aws:ResourceTag/${key}`] = tag;
      return { ...request, context };
    });
  const desired = productionDeploymentPolicies(config, inventory.bindings);
  // Source/configuration problems fail before requesting even read-only AWS.
  verifyPermissionInventory(
    inventory,
    Object.values(desired.deploy),
    desired.boundary,
  );
  try {
    const applied = appliedProductionPolicies(aws, config);
    return verifyPermissionInventory(
      inventory,
      applied.deploy,
      applied.runtimeBoundary,
      applied.deployBoundary,
    );
  } catch (error) {
    throw new Error(
      `Production permission preflight blocked apply. Review the existing deployment role and runtime boundary through a separately authorized IAM operation. ${error.message}`,
    );
  }
}
