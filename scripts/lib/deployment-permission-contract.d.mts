import type { DemoConfiguration } from './demo-controls.mjs';
import type { PolicyDocument } from './demo-role-policies.mjs';
export interface TerraformResource {
  address: string;
  type: string;
  mode: string;
  values: Record<string, unknown>;
}
export interface PermissionRequest {
  action: string;
  resource: string;
  context?: Record<string, string | undefined>;
  contextPatterns?: Record<string, string>;
}
export interface PermissionCase extends PermissionRequest {
  source: string;
  ownershipSource: string;
}
export interface PermissionInventory {
  version: 1;
  resources: TerraformResource[];
  roles: TerraformResource[];
  functions: TerraformResource[];
  queues: TerraformResource[];
  requests: PermissionCase[];
  runtime: Array<{ source: string; role: string; policy: PolicyDocument }>;
  bindings: { apiId?: string; oacId?: string };
}
export interface PermissionResult {
  resources: number;
  deploymentCases: number;
  runtimeCases: number;
}
export function permissionInventory(
  root: unknown,
  config: DemoConfiguration,
): PermissionInventory;
export function verifyPermissionInventory(
  inventory: PermissionInventory,
  deployPolicies: PolicyDocument[],
  boundary: PolicyDocument,
  deployBoundary?: PolicyDocument,
): PermissionResult;
