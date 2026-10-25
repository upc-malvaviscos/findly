import type { DemoConfiguration } from './demo-controls.mjs';
import type { TerraformResource } from './deployment-permission-contract.mjs';
export interface PlanChange {
  actions: string[];
  before?: Record<string, unknown> | null;
  after_unknown?: Record<string, unknown>;
}
export function productionPlanResources(
  plan: unknown,
  mockedRoot: unknown,
  config: DemoConfiguration,
): { resources: TerraformResource[]; changes: Map<string, PlanChange> };
export function mockVariablesForPlan(
  plan: unknown,
  config: DemoConfiguration,
): Record<string, unknown>;
