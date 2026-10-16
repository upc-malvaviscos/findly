import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Statement {
  Sid: string;
  Action: string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

const policy = JSON.parse(
  readFileSync('infra/iam/ephemeral-pr-extensions.json', 'utf8'),
) as { Statement: Statement[] };

function statement(sid: string) {
  const found = policy.Statement.find((item) => item.Sid === sid);
  if (!found) throw new Error(`Missing policy statement: ${sid}`);
  return found;
}

describe('ephemeral backfill provisioning boundary (static contract, not AWS)', () => {
  it('limits DLQ alarm management to the two named ephemeral alarm families', () => {
    expect(statement('EphemeralDlqAlarm').Resource).toEqual([
      'arn:aws:cloudwatch:eu-west-1:567158658992:alarm:findly-pr-*-photos-dlq-has-messages',
      'arn:aws:cloudwatch:eu-west-1:567158658992:alarm:findly-pr-*-backfill-dlq-has-messages',
    ]);
  });

  it('restricts mapping creation and lifecycle to the matcher and backfill', () => {
    for (const sid of [
      'EphemeralCreatePhotoQueueMapping',
      'EphemeralPhotoQueueMappingLifecycle',
    ]) {
      expect(statement(sid).Condition?.ArnLike?.['lambda:FunctionArn']).toEqual(
        [
          'arn:aws:lambda:eu-west-1:567158658992:function:findly-pr-*-photo-matcher',
          'arn:aws:lambda:eu-west-1:567158658992:function:findly-pr-*-registration-backfill',
        ],
      );
    }
    const creation = statement('EphemeralCreatePhotoQueueMapping');
    expect(creation.Action).toEqual(['lambda:CreateEventSourceMapping']);
    expect(creation.Condition?.StringEquals).toEqual({
      'aws:RequestedRegion': 'eu-west-1',
      'aws:RequestTag/Project': 'findly',
      'aws:RequestTag/Ephemeral': 'true',
    });
    expect(creation.Condition?.StringLike).toEqual({
      'aws:RequestTag/Environment': 'pr-?*',
      'aws:RequestTag/PullRequest': '?*',
    });
  });

  it('tags the backfill mapping so provider default CI tags accompany creation', () => {
    const module = readFileSync(
      'infra/modules/registration-backfill/main.tf',
      'utf8',
    );
    expect(module).toMatch(
      /resource "aws_lambda_event_source_mapping" "backfill" \{[^}]*tags\s*=\s*local.tags/s,
    );
    const root = readFileSync('infra/ephemeral/main.tf', 'utf8');
    expect(root).toMatch(/Ephemeral\s*=\s*"true"/);
    expect(root).toMatch(/PullRequest\s*=/);
  });
});
