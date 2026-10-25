import type { DemoConfiguration } from './demo-controls.mjs';
import type { TerraformResource } from './deployment-permission-contract.mjs';
export const inventoryConfig: Readonly<DemoConfiguration>;
export const inventoryVariables: Readonly<
  Record<string, string | boolean | null>
>;
export function flattenResources(root: unknown): TerraformResource[];
export function inventoryOverrides(
  resource: unknown,
  config?: DemoConfiguration,
): Record<string, string> | null;
export function terraformPermissionState(
  repository?: string,
  variables?: Readonly<Record<string, unknown>>,
): { root_module: unknown };
