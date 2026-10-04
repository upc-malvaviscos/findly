import { describe, expect, it } from 'vitest';
import { productionDeploymentPolicies } from '../../scripts/lib/production-role-policies.mjs';

const config = {
  account: '123456789012',
  region: 'eu-west-1',
  stateBucket: 'findly-terraform-state-123456789012',
  uploadsBucket: 'findly-production-uploads-123456789012-eu-west-1',
  webBucket: 'findly-production-web-123456789012-eu-west-1',
};
const statements = productionDeploymentPolicies(config).deploy.edge.Statement;
const requestedTags = {
  'aws:RequestTag/Project': 'findly',
  'aws:RequestTag/Environment': 'production',
  'aws:RequestTag/ManagedBy': 'Terraform',
  'aws:RequestTag/CostCenter': 'findly',
  'aws:RequestedRegion': 'eu-west-1',
};

describe('production CloudFront creation authorization', () => {
  it('uses the AWS-required wildcard only for creation and requires ownership labels', () => {
    const creation = statements.filter((statement) =>
      [statement.Action].flat().includes('cloudfront:CreateDistribution'),
    );
    expect(creation).toHaveLength(1);
    expect(creation[0]?.Resource).toBe('*');
    expect(creation[0]?.Action).toEqual(['cloudfront:CreateDistribution']);
    expect(creation[0]?.Condition).toEqual({
      StringEquals: {
        'aws:RequestTag/Project': 'findly',
        'aws:RequestTag/Environment': 'production',
        'aws:RequestTag/ManagedBy': 'Terraform',
        'aws:RequestTag/CostCenter': 'findly',
      },
    });
  });
});

describe.each([
  'cloudfront:TagResource',
  'cognito-idp:TagResource',
  'apigateway:POST',
])('production ownership for %s', (action) => {
  const grants = statements.filter(
    (statement) =>
      statement.Effect === 'Allow' &&
      [statement.Action].flat().includes(action) &&
      (action !== 'apigateway:POST' ||
        [statement.Resource]
          .flat()
          .some((resource) => resource.includes('/tags/'))),
  );

  // Evaluate the ownership conditions with AWS's fail-closed StringEquals
  // semantics: requested labels never establish the current resource owner.
  const permitted = (currentTags: Record<string, string | undefined>) => {
    const context: Record<string, string | undefined> = {
      ...requestedTags,
      ...currentTags,
    };
    return grants.some((grant) => {
      expect(Object.keys(grant.Condition ?? {})).toEqual(['StringEquals']);
      const equals = grant.Condition?.StringEquals;
      if (!equals) throw new Error('Ownership conditions must be present');
      return Object.entries(equals).every(
        ([key, value]) => context[key] === value,
      );
    });
  };

  it.each([
    {},
    {
      'aws:ResourceTag/Project': 'findly',
      'aws:ResourceTag/Environment': 'demo',
    },
    {
      'aws:ResourceTag/Project': 'findly',
      'aws:ResourceTag/Environment': 'shared',
    },
    {
      'aws:ResourceTag/Project': 'foreign',
      'aws:ResourceTag/Environment': 'production',
    },
  ])('rejects relabelling a foreign or unowned resource: %j', (tags) => {
    expect(grants.length).toBeGreaterThan(0);
    expect(permitted(tags)).toBe(false);
  });

  it('allows maintaining a resource already owned by production', () => {
    expect(
      permitted({
        'aws:ResourceTag/Project': 'findly',
        'aws:ResourceTag/Environment': 'production',
      }),
    ).toBe(true);
  });
});
