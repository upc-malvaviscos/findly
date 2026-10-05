import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productionDeploymentPolicies } from '../../scripts/lib/production-role-policies.mjs';

const config = {
  account: '123456789012',
  region: 'eu-west-1',
  stateBucket: 'findly-terraform-state-123456789012',
  uploadsBucket: 'findly-production-uploads-123456789012-eu-west-1',
  webBucket: 'findly-production-web-123456789012-eu-west-1',
};
const documents = productionDeploymentPolicies(config);

describe('production role isolation', () => {
  it('allows stage creation on the exact bound API using valid HTTP-method IAM actions', () => {
    const bound = productionDeploymentPolicies(config, {
      apiId: 'production123',
    });
    expect(
      bound.deploy.edge.Statement.some(
        (statement) =>
          [statement.Action].flat().includes('apigateway:POST') &&
          [statement.Resource]
            .flat()
            .includes('arn:aws:apigateway:eu-west-1::/apis/production123/*'),
      ),
    ).toBe(true);
    expect(JSON.stringify(bound.deploy)).not.toContain(
      'apigateway:TagResource',
    );
  });
  it('limits the approved V2 tagging exception to the bound stage collection and required request context', () => {
    const bound = productionDeploymentPolicies(config, {
      apiId: 'production123',
    });
    const exceptions = bound.deploy.edge.Statement.filter((statement) =>
      [statement.Action].flat().includes('apigateway:*'),
    );
    expect(exceptions).toEqual([
      {
        Effect: 'Allow',
        Action: ['apigateway:*'],
        Resource: 'arn:aws:apigateway:eu-west-1::/apis/production123/stages',
        Condition: {
          StringEquals: {
            'aws:RequestTag/Project': 'findly',
            'aws:RequestTag/Environment': 'production',
            'aws:RequestTag/ManagedBy': 'Terraform',
            'aws:RequestTag/CostCenter': 'findly',
            'aws:RequestedRegion': 'eu-west-1',
          },
        },
      },
    ]);
    expect(JSON.stringify(documents.deploy)).not.toContain('apigateway:*');
  });
  it('authorizes SNS subscription refresh using its parent feedback topic', () => {
    const reads = documents.deploy.core.Statement.filter(
      (statement) =>
        statement.Effect === 'Allow' &&
        [statement.Action].flat().includes('sns:GetSubscriptionAttributes'),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.Resource).toBe(
      'arn:aws:sns:eu-west-1:123456789012:findly-production-gallery-email-feedback',
    );
    for (const foreignTopic of [
      'arn:aws:sns:eu-west-1:123456789012:findly-demo-gallery-email-feedback',
      'arn:aws:sns:eu-west-1:123456789012:foreign-feedback',
    ]) {
      expect(
        reads.some((statement) => statement.Resource === foreignTopic),
      ).toBe(false);
    }
  });
  it('refuses foreign buckets instead of authorizing them', () => {
    for (const name of ['stateBucket', 'uploadsBucket', 'webBucket']) {
      expect(() =>
        productionDeploymentPolicies({ ...config, [name]: 'foreign' }),
      ).toThrow();
    }
  });
  it('requires a boundary for runtime role creation and prevents its removal', () => {
    const statements = documents.deploy.core.Statement;
    const creation = statements.filter((statement) =>
      [statement.Action].flat().includes('iam:CreateRole'),
    );
    expect(creation).toHaveLength(1);
    expect(
      creation[0]?.Condition?.StringEquals?.['iam:PermissionsBoundary'],
    ).toBe(documents.boundaryArn);
    expect(
      statements.some(
        (statement) =>
          statement.Effect === 'Deny' &&
          statement.Action === 'iam:DeleteRolePermissionsBoundary',
      ),
    ).toBe(true);
    const allowedBoundary = documents.boundary.Statement.flatMap((statement) =>
      [statement.Action].flat(),
    );
    expect(
      allowedBoundary.some(
        (action) => action.startsWith('iam:') || action.startsWith('sts:'),
      ),
    ).toBe(false);
  });
  it('applies the boundary to every application and scheduler role declared by Terraform', () => {
    for (const name of [
      'admin-api',
      'public-enrollment',
      'selfie-indexer',
      'gallery-reader',
      'delete-registration',
      'retention-purger',
      'photo-matching',
      'gallery-email',
    ]) {
      const source = readFileSync(`infra/modules/${name}/main.tf`, 'utf8');
      const roles = [
        ...source.matchAll(
          /resource "aws_iam_role" "[^"]+" \{([^]*?)(?=\nresource |$)/g,
        ),
      ];
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles)
        expect(role[1]).toContain(
          'permissions_boundary = var.permissions_boundary_arn',
        );
    }
  });
  it('does not grant a production destruction role or resource permissions for other environments', () => {
    expect(documents).not.toHaveProperty('destroy');
    expect(JSON.stringify(documents)).not.toContain('findly-demo');
    expect(JSON.stringify(documents)).not.toContain('findly-sandbox');
    const allowed = [documents.deploy.core, documents.deploy.edge]
      .flatMap((document) =>
        document.Statement.filter((statement) => statement.Effect === 'Allow'),
      )
      .flatMap((statement) => [statement.Action].flat());
    expect(allowed).not.toContain('dynamodb:DeleteTable');
    expect(allowed).not.toContain('ses:SendEmail');
    expect(allowed).not.toContain('iam:CreatePolicyVersion');
  });
});
