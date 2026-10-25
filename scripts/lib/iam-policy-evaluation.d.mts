import type { PermissionRequest } from './deployment-permission-contract.mjs';
import type { PolicyDocument } from './demo-role-policies.mjs';
export function validateIdentityPolicy(
  policy: unknown,
): asserts policy is PolicyDocument;
export function resourcePatternCovered(
  required: string,
  allow: string[],
  deny?: string[],
): boolean;
export function policyDecision(
  policies: readonly unknown[],
  request: PermissionRequest,
): 'allowed' | 'implicitDeny' | 'explicitDeny';
export function requirePermission(
  policies: readonly unknown[],
  request: PermissionRequest,
  source: string,
): void;
export function requireResourcePattern(
  policies: readonly unknown[],
  request: PermissionRequest,
  source: string,
): void;
