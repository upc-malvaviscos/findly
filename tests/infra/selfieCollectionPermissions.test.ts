import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SelfieIndexer collection creation IAM', () => {
  it('allows collection tagging only in the existing regional/account collection scope', () => {
    const module = readFileSync('infra/modules/selfie-indexer/main.tf', 'utf8');
    const statements = [
      ...module.matchAll(
        /Action\s*=\s*(\[[^\]]+\]),\s*Resource\s*=\s*"([^"]+)"/g,
      ),
    ].map((match) => ({
      actions: JSON.parse(match[1]!) as string[],
      resource: match[2]!,
    }));
    const tagging = statements.filter((statement) =>
      statement.actions.includes('rekognition:TagResource'),
    );
    expect(tagging).toHaveLength(1);
    expect(tagging[0]!.actions).toContain('rekognition:CreateCollection');
    expect(tagging[0]!.resource).toBe(
      'arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/${local.prefix}-event-*',
    );
  });
});
