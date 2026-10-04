import type { DemoConfiguration } from './demo-controls.mjs';
import type {
  PolicyDocument,
  RoleDocuments,
  TrustDocument,
} from './demo-role-policies.mjs';
export function productionDeploymentPolicies(
  config: DemoConfiguration,
  bindings?: {
    apiId?: string;
    oacId?: string;
    distributionId?: string;
    poolId?: string;
  },
): {
  trust: TrustDocument;
  deploy: RoleDocuments;
  boundary: PolicyDocument;
  boundaryArn: string;
};
