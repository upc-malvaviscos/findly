export interface DemoConfiguration {
  account: string;
  region: string;
  stateBucket: string;
  uploadsBucket: string;
  webBucket: string;
}
export interface DemoInventory {
  resources: Array<{
    address: string;
    type: string;
    id: string;
    value: Record<string, unknown>;
  }>;
  buckets: string[];
  functions: Array<{ name: string; timeout: number }>;
  schedules: Array<{ name: string; group: string }>;
}
export const demoActors: string[];
export const demoStateKey: string;
export const destroyConfirmation: string;
export function authorizeDemo(context: {
  repository?: string;
  ref?: string;
  event?: string;
  actor?: string;
  triggeringActor?: string;
  environment?: string;
  operation?: string;
  confirmation?: string;
}): void;
export function demoConfiguration(
  env: Record<string, string | undefined>,
): DemoConfiguration;
export function validateDestroyPlan(
  plan: unknown,
  config: DemoConfiguration,
): DemoInventory;
