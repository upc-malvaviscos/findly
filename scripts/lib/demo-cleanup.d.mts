import type { DemoConfiguration, DemoInventory } from './demo-controls.mjs';
export type AwsCommand = (
  service: string,
  operation: string,
  input: Record<string, unknown>,
) => unknown;
export function requireDemoTags(tags: unknown): void;
export function emptyDemoBucket(
  aws: AwsCommand,
  bucket: string,
  config: DemoConfiguration,
): Promise<void>;
export function demoCollectionIds(
  aws: AwsCommand,
  config: DemoConfiguration,
): string[];
export function quiesceDemo(
  aws: AwsCommand,
  inventory: Pick<DemoInventory, 'buckets' | 'functions' | 'schedules'>,
  config: DemoConfiguration,
  pause: (milliseconds: number) => Promise<void>,
): Promise<void>;
