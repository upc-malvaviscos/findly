import { describe, expect, it } from 'vitest';
import {
  demoRolePolicies,
  partitionManagedPolicies,
} from '../../scripts/lib/demo-role-policies.mjs';
const config = {
  account: '123456789012',
  region: 'eu-west-1',
  stateBucket: 'findly-terraform-state-123456789012',
  uploadsBucket: 'findly-demo-uploads-123456789012-eu-west-1',
  webBucket: 'findly-demo-web-123456789012-eu-west-1',
};

describe('reviewable independent OIDC demo roles', () => {
  it('permits mandatory provider reads without widening Lambda mutation or Cognito ownership', () => {
    const result = demoRolePolicies(config);
    for (const role of [result.deploy, result.destroy]) {
      const functions = role.core.Statement.find((s) =>
        s.Action.includes('lambda:GetFunctionCodeSigningConfig'),
      );
      expect(functions?.Action).toContain('lambda:ListVersionsByFunction');
      expect(Array.isArray(functions?.Resource)).toBe(true);
      expect(functions?.Resource).toHaveLength(12);
      const pool = role.edge.Statement.find((s) =>
        s.Action.includes('cognito-idp:GetUserPoolMfaConfig'),
      );
      expect(pool?.Condition).toEqual({
        StringEquals: {
          'aws:ResourceTag/Project': 'findly',
          'aws:ResourceTag/Environment': 'demo',
        },
      });
    }
  });
  it('permits Terraform bucket refresh only on the two demo buckets', () => {
    const result = demoRolePolicies(config);
    for (const role of [result.deploy, result.destroy]) {
      const refresh = role.core.Statement.find((s) =>
        s.Action.includes('s3:GetBucketAcl'),
      );
      expect(refresh?.Resource).toEqual([
        `arn:aws:s3:::${config.uploadsBucket}`,
        `arn:aws:s3:::${config.webBucket}`,
      ]);
      expect(refresh?.Action).toEqual(
        expect.arrayContaining([
          's3:GetBucketWebsite',
          's3:GetAccelerateConfiguration',
          's3:GetBucketRequestPayment',
          's3:GetBucketLogging',
          's3:GetReplicationConfiguration',
          's3:GetBucketObjectLockConfiguration',
        ]),
      );
    }
  });
  it('authorizes absence checks by exact IDs after resource tags disappear', () => {
    const result = demoRolePolicies(config, {
      distributionId: 'EDEMO123',
      poolId: 'eu-west-1_Demo123',
    });
    const statements = result.destroy.edge.Statement;
    expect(
      statements.some(
        (s) =>
          s.Action.includes('cloudfront:GetDistribution') &&
          s.Resource ===
            'arn:aws:cloudfront::123456789012:distribution/EDEMO123' &&
          !s.Condition,
      ),
    ).toBe(true);
    expect(
      statements.some(
        (s) =>
          s.Action.includes('cognito-idp:DescribeUserPool') &&
          s.Resource ===
            'arn:aws:cognito-idp:eu-west-1:123456789012:userpool/eu-west-1_Demo123' &&
          !s.Condition,
      ),
    ).toBe(true);
  });
  it('restricts trust to the protected demo environment and exact audience', () => {
    const { trust } = demoRolePolicies(config);
    expect(trust.Statement[0]?.Condition.StringEquals).toEqual({
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub':
        'repo:upc-malvaviscos/findly:environment:demo',
    });
  });
  it('fits AWS managed policy limits and protects the backend and operational roles', () => {
    const result = demoRolePolicies(config);
    for (const documents of [result.deploy, result.destroy]) {
      const parts = partitionManagedPolicies(documents);
      expect(parts.length).toBeLessThanOrEqual(10);
      expect(parts.every((p) => JSON.stringify(p).length <= 6000)).toBe(true);
      const statements = parts.flatMap((p) => p.Statement);
      expect(
        statements.some(
          (s) =>
            s.Effect === 'Deny' &&
            s.Resource.includes(`arn:aws:s3:::${config.stateBucket}`),
        ),
      ).toBe(true);
      expect(
        statements.some(
          (s) =>
            s.Effect === 'Deny' &&
            s.Resource.includes(
              'arn:aws:iam::123456789012:role/findly-demo-deploy',
            ),
        ),
      ).toBe(true);
    }
  });
  it('does not allow arbitrary API child or OAC mutation before exact bindings exist', () => {
    const unbound = demoRolePolicies(config);
    expect(JSON.stringify(unbound.destroy.edge)).not.toContain(
      'cloudfront:DeleteOriginAccessControl',
    );
    const bound = demoRolePolicies(config, {
      apiId: 'demo123',
      oacId: 'EOAC123',
    });
    const statement = bound.destroy.edge.Statement.find((s) =>
      s.Action.includes('cloudfront:DeleteOriginAccessControl'),
    );
    expect(statement?.Resource).toBe(
      'arn:aws:cloudfront::123456789012:origin-access-control/EOAC123',
    );
    expect(JSON.stringify(bound.deploy.edge)).toContain('/apis/demo123/*');
    expect(JSON.stringify(bound.deploy.edge)).toContain(
      '%2Fv2%2Fapis%2Fdemo123',
    );
  });
});
