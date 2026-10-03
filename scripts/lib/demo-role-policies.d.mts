import type { DemoConfiguration } from './demo-controls.mjs';
export interface PolicyStatement {
  Effect: string;
  Action: string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}
export interface PolicyDocument {
  Version: string;
  Statement: PolicyStatement[];
}
export interface TrustDocument {
  Version: string;
  Statement: Array<{
    Effect: string;
    Principal: { Federated: string };
    Action: string;
    Condition: { StringEquals: Record<string, string> };
  }>;
}
export interface RoleDocuments {
  core: PolicyDocument;
  edge: PolicyDocument;
}
export function demoRolePolicies(
  config: DemoConfiguration,
  bindings?: {
    apiId?: string;
    oacId?: string;
    distributionId?: string;
    poolId?: string;
  },
): { trust: TrustDocument; deploy: RoleDocuments; destroy: RoleDocuments };
export function partitionManagedPolicies(
  documents: RoleDocuments,
): PolicyDocument[];
