import type { DemoConfiguration } from './demo-controls.mjs';
import type { AwsReader } from './applied-production-policies.mjs';
import type { PermissionResult } from './deployment-permission-contract.mjs';
export function productionPermissionPreflight(
  plan: unknown,
  mockedRoot: unknown,
  config: DemoConfiguration,
  aws: AwsReader,
): PermissionResult;
