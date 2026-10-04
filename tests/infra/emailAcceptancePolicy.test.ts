import { describe, expect, it } from 'vitest';
import { createEmailAcceptanceManifest } from '../../scripts/lib/email-acceptance-manifest.mjs';
import { emailAcceptancePolicy } from '../../scripts/lib/email-acceptance-policy.mjs';
import { partitionManagedPolicies } from '../../scripts/lib/demo-role-policies.mjs';

const manifest = createEmailAcceptanceManifest();
const { trust, policy } = emailAcceptancePolicy(manifest);
describe('reviewed per-run AWS email acceptance operator', () => {
  it('binds DynamoDB to the table and every exact pre-reviewed leading key', () => {
    const grant = policy.Statement.find((statement) =>
      [statement.Action].flat().includes('dynamodb:PutItem'),
    );
    expect(grant?.Resource).toBe(
      'arn:aws:dynamodb:eu-west-1:567158658992:table/findly-production',
    );
    expect(
      grant?.Condition?.['ForAllValues:StringEquals']?.['dynamodb:LeadingKeys'],
    ).toEqual(manifest.leadingKeys);
    expect(grant?.Condition?.Null?.['dynamodb:LeadingKeys']).toBe('false');
    expect(JSON.stringify(grant)).not.toContain('TOKEN#*');
    expect(JSON.stringify(grant)).not.toContain('/index/');
  });
  it('limits S3 and Rekognition mutations to the synthetic events in the manifest', () => {
    const storage = policy.Statement.find((statement) =>
      [statement.Action].flat().includes('s3:DeleteObject'),
    );
    expect(storage?.Resource).toEqual(
      manifest.fixtures.map(
        ({ eventId }) =>
          `arn:aws:s3:::findly-production-uploads-567158658992-eu-west-1/events/${eventId}/*`,
      ),
    );
    const collections = policy.Statement.find((statement) =>
      [statement.Action].flat().includes('rekognition:DeleteCollection'),
    );
    expect(collections?.Resource).toEqual(
      manifest.fixtures.map(
        ({ collectionId }) =>
          `arn:aws:rekognition:eu-west-1:567158658992:collection/${collectionId}`,
      ),
    );
  });
  it('permits returning foreign messages to visibility but no infrastructure, IAM or bulk queue mutations', () => {
    const actions = policy.Statement.flatMap((statement) =>
      [statement.Action].flat(),
    );
    expect(actions).toContain('sqs:ChangeMessageVisibility');
    for (const denied of [
      'iam:CreateRole',
      'ses:SendEmail',
      'dynamodb:Scan',
      'dynamodb:BatchWriteItem',
      'sqs:PurgeQueue',
      'sqs:StartMessageMoveTask',
      'sqs:SetQueueAttributes',
      's3:DeleteBucket',
      's3:DeleteObjectVersion',
      'lambda:UpdateFunctionConfiguration',
      'cognito-idp:AdminCreateUser',
    ])
      expect(actions).not.toContain(denied);
    expect(actions.some((action) => action.startsWith('iam:'))).toBe(false);
  });
  it('makes the regional suppression exception explicit and expires all access', () => {
    const suppression = policy.Statement.find((statement) =>
      [statement.Action].flat().includes('ses:PutSuppressedDestination'),
    );
    expect(suppression?.Resource).toBe('*');
    expect(suppression?.Condition?.StringEquals?.['aws:RequestedRegion']).toBe(
      'eu-west-1',
    );
    for (const statement of policy.Statement)
      expect(statement.Condition?.DateLessThan?.['aws:CurrentTime']).toBe(
        manifest.expiresAt,
      );
    expect(
      trust.Statement[0]?.Condition.StringEquals?.[
        'token.actions.githubusercontent.com:sub'
      ],
    ).toBe('repo:upc-malvaviscos/findly:environment:production');
    expect(
      partitionManagedPolicies({
        core: policy,
        edge: { Version: '2012-10-17', Statement: [] },
      }).every((part) => JSON.stringify(part).length <= 6000),
    ).toBe(true);
  });
  it('allows only filtered processing evidence from the exact photo matcher group', () => {
    const photoLog = policy.Statement.filter((statement) =>
      [statement.Resource]
        .flat()
        .some((resource) => resource.includes('photo-matcher')),
    );
    expect(photoLog).toHaveLength(1);
    expect(photoLog[0]?.Action).toBe('logs:FilterLogEvents');
    expect(photoLog[0]?.Resource).toBe(
      'arn:aws:logs:eu-west-1:567158658992:log-group:/aws/lambda/findly-production-photo-matcher:*',
    );
  });
});
