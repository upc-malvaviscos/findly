import type { PolicyDocument } from './demo-role-policies.mjs';
export function emailAcceptancePolicy(
  manifest: unknown,
  options?: { now?: number; allowExpired?: boolean },
): {
  trust: {
    Version: string;
    Statement: Array<{
      Effect: string;
      Principal: { Federated: string };
      Action: string;
      Condition: Record<string, Record<string, string>>;
    }>;
  };
  policy: PolicyDocument;
};
