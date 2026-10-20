import { describe, expect, it } from 'vitest';
import {
  isDocumentationFile,
  requiresEphemeralDeployment,
} from '../../scripts/lib/ephemeral-pr-eligibility.mjs';

describe('ephemeral PR deployment eligibility', () => {
  describe('isDocumentationFile', () => {
    it('recognizes markdown and documentation trees as documentation', () => {
      expect(
        isDocumentationFile('docs/evidence/admin-invitations-aws-plan.md'),
      ).toBe(true);
      expect(
        isDocumentationFile('specs/15-scheduled-nonproduction-teardown.md'),
      ).toBe(true);
      expect(isDocumentationFile('README.md')).toBe(true);
      expect(isDocumentationFile('AGENTS.md')).toBe(true);
      expect(isDocumentationFile('.github/PULL_REQUEST_TEMPLATE.md')).toBe(
        true,
      );
      expect(isDocumentationFile('docs/traceability.json')).toBe(true);
      expect(
        isDocumentationFile(
          'docs/paper/memoria-findly/img/portada_abstracta.svg',
        ),
      ).toBe(true);
      expect(isDocumentationFile('LICENSE')).toBe(true);
      expect(isDocumentationFile('.gitignore')).toBe(true);
    });

    it('identifies code, infrastructure, and workflows as non-documentation', () => {
      expect(isDocumentationFile('src/lambdas/photoMatcher.ts')).toBe(false);
      expect(isDocumentationFile('infra/ephemeral/main.tf')).toBe(false);
      expect(
        isDocumentationFile('.github/workflows/ephemeral-pr-e2e.yml'),
      ).toBe(false);
      expect(isDocumentationFile('package.json')).toBe(false);
      expect(isDocumentationFile('scripts/invite-admin.mjs')).toBe(false);
      expect(
        isDocumentationFile('tests/infra/ephemeralPrEligibility.test.ts'),
      ).toBe(false);
    });

    it('handles empty, null, or invalid input safely', () => {
      expect(isDocumentationFile('')).toBe(false);
      expect(isDocumentationFile('   ')).toBe(false);
      expect(isDocumentationFile(null)).toBe(false);
      expect(isDocumentationFile(undefined)).toBe(false);
      expect(isDocumentationFile(123)).toBe(false);
    });
  });

  describe('requiresEphemeralDeployment', () => {
    it('returns false for empty or non-array inputs', () => {
      expect(requiresEphemeralDeployment([])).toBe(false);
      expect(requiresEphemeralDeployment(null)).toBe(false);
      expect(requiresEphemeralDeployment(undefined)).toBe(false);
      expect(requiresEphemeralDeployment('not-an-array')).toBe(false);
    });

    it('returns false when all changed files are documentation or specs', () => {
      const docsOnly = [
        'docs/evidence/admin-invitations-aws-plan.md',
        'docs/paper/08-validacion-y-resultados.md',
        'specs/04-admin-event-management-and-cognito-authorization.md',
        'README.md',
      ];
      expect(requiresEphemeralDeployment(docsOnly)).toBe(false);
    });

    it('returns true when changes touch application code', () => {
      const codeChanges = [
        'docs/evidence/admin-invitations-aws-plan.md',
        'src/lambdas/photoMatcher.ts',
      ];
      expect(requiresEphemeralDeployment(codeChanges)).toBe(true);
    });

    it('returns true when changes touch Terraform infrastructure', () => {
      const infraChanges = ['infra/ephemeral/main.tf'];
      expect(requiresEphemeralDeployment(infraChanges)).toBe(true);
    });

    it('returns true when changes touch GitHub workflows', () => {
      const workflowChanges = ['.github/workflows/ephemeral-pr-e2e.yml'];
      expect(requiresEphemeralDeployment(workflowChanges)).toBe(true);
    });

    it('returns true when changes touch package manifests or scripts', () => {
      expect(requiresEphemeralDeployment(['package.json'])).toBe(true);
      expect(
        requiresEphemeralDeployment(['scripts/check-admin-invitation-aws.mjs']),
      ).toBe(true);
    });
  });
});
