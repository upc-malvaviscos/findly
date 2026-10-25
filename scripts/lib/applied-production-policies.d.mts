import type { DemoConfiguration } from './demo-controls.mjs';
import type { PolicyDocument } from './demo-role-policies.mjs';
export type AwsReader = (
  service: string,
  command: string,
  input?: Record<string, unknown>,
) => unknown;
export function decodePolicyDocument(value: unknown): PolicyDocument;
export function appliedProductionPolicies(
  aws: AwsReader,
  config: DemoConfiguration,
): {
  deploy: PolicyDocument[];
  runtimeBoundary: PolicyDocument;
  deployBoundary?: PolicyDocument;
};
