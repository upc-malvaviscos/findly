import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Rekognition namespace infrastructure boundary', () => {
  it.each(['photo-matching', 'retention-purger', 'delete-registration'])(
    'restricts %s operations and runtime naming to its own environment',
    (name) => {
      const module = readFileSync(`infra/modules/${name}/main.tf`, 'utf8');
      expect(module).toContain(
        'arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/${var.project}-${var.environment}-event-*',
      );
      expect(module).toMatch(
        /FINDLY_COLLECTION_NAMESPACE\s*=\s*"\$\{var.project\}-\$\{var.environment\}"/,
      );
      expect(module).not.toContain('arn:aws:rekognition:*:*:');
      expect(module).not.toContain('collection/findly-event-*');
    },
  );

  it('uses the same project/environment prefix for SelfieIndexer naming and IAM', () => {
    const module = readFileSync('infra/modules/selfie-indexer/main.tf', 'utf8');
    expect(module).toMatch(
      /prefix\s*=\s*"\$\{var.project\}-\$\{var.environment\}"/,
    );
    expect(module).toMatch(/FINDLY_COLLECTION_NAMESPACE\s*=\s*local.prefix/);
    expect(module).toContain('collection/${local.prefix}-event-*');
    expect(module).not.toContain('collection/findly-event-*');
  });

  it('exports the PR collection namespace for safe smoke cleanup', () => {
    const outputs = readFileSync('infra/ephemeral/outputs.tf', 'utf8');
    expect(outputs).toContain(
      'output "collection_namespace" { value = "findly-${local.environment}" }',
    );
  });
});
