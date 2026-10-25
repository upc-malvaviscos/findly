import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvedEphemeralSkip,
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

describe('explicit operator approval to skip ephemeral AWS deployment', () => {
  it('accepts only the reviewed label on a trusted-author PR', () => {
    expect(approvedEphemeralSkip('anyulled', ['skip-ephemeral-approved'])).toBe(
      true,
    );
    expect(approvedEphemeralSkip('outsider', ['skip-ephemeral-approved'])).toBe(
      false,
    );
    expect(approvedEphemeralSkip('anyulled', [])).toBe(false);
    expect(
      approvedEphemeralSkip(
        'anyulled',
        [],
        'feat(auth): recovery [skip-ephemeral-approved]',
      ),
    ).toBe(true);
    expect(
      approvedEphemeralSkip(
        'outsider',
        [],
        'feat(auth): recovery [skip-ephemeral-approved]',
      ),
    ).toBe(false);
    expect(approvedEphemeralSkip('anyulled', 'skip-ephemeral-approved')).toBe(
      false,
    );
  });
});

const paperFiles = [
  'docs/paper/memoria-findly/memoria-postgrado.md',
  '.github/workflows/memoria-pdf.yml',
  'scripts/pandoc-container.mjs',
  'scripts/lib/memoria-release.mjs',
  'scripts/lib/memoria-release.d.mts',
  'tests/infra/memoriaRelease.test.ts',
];
const basePackage = {
  name: 'synthetic-findly',
  scripts: { build: 'vite build', prepare: 'husky' },
  dependencies: { react: '19.2.8' },
  engines: { node: '24' },
};
const paperPackage = {
  ...basePackage,
  scripts: { ...basePackage.scripts, 'paper:pdf': 'make pdf' },
};
const packageChange = {
  basePackageJson: JSON.stringify(basePackage),
  headPackageJson: JSON.stringify(paperPackage),
};

describe('PDF-only tooling eligibility', () => {
  it('skips AWS for the exact PDF tooling paths', () => {
    expect(requiresEphemeralDeployment(paperFiles)).toBe(false);
  });

  it('skips an additive, changed or removed paper:pdf entry only', () => {
    expect(
      requiresEphemeralDeployment(
        [...paperFiles, 'package.json'],
        packageChange,
      ),
    ).toBe(false);
    expect(
      requiresEphemeralDeployment(['package.json'], {
        basePackageJson: JSON.stringify(paperPackage),
        headPackageJson: JSON.stringify({
          ...paperPackage,
          scripts: { ...paperPackage.scripts, 'paper:pdf': 'make strict-pdf' },
        }),
      }),
    ).toBe(false);
    expect(
      requiresEphemeralDeployment(['package.json'], {
        basePackageJson: packageChange.headPackageJson,
        headPackageJson: packageChange.basePackageJson,
      }),
    ).toBe(false);
  });

  it.each([
    'src/lambdas/gallery.ts',
    'src/web/App.tsx',
    'infra/ephemeral/main.tf',
    '.github/workflows/deploy.yml',
    '.github/workflows/ephemeral-pr-e2e.yml',
    'package-lock.json',
    'scripts/build-recovery-web.mjs',
    'scripts/lib/ephemeral-pr-eligibility.mjs',
    'tests/infra/ephemeralPrEligibility.test.ts',
  ])('keeps mixed changes deployment-relevant: %s', (file) => {
    expect(
      requiresEphemeralDeployment(
        [...paperFiles, 'package.json', file],
        packageChange,
      ),
    ).toBe(true);
  });

  it.each([
    { ...paperPackage, dependencies: { react: '20.0.0' } },
    { ...paperPackage, engines: { node: '25' } },
    {
      ...paperPackage,
      scripts: { ...paperPackage.scripts, prepare: 'other-hook' },
    },
    {
      ...paperPackage,
      scripts: { ...paperPackage.scripts, build: 'other-build' },
    },
    { ...paperPackage, version: '2.0.0' },
  ])('does not hide any other manifest change', (head) => {
    expect(
      requiresEphemeralDeployment(['package.json'], {
        ...packageChange,
        headPackageJson: JSON.stringify(head),
      }),
    ).toBe(true);
  });

  it.each([undefined, '', '{', '[]', 'null', '{"scripts": []}'])(
    'fails closed without valid manifest content: %s',
    (headPackageJson) => {
      expect(
        requiresEphemeralDeployment(['package.json'], {
          basePackageJson: packageChange.basePackageJson,
          headPackageJson,
        }),
      ).toBe(true);
    },
  );
});

describe('eligibility runner against a real synthetic Git history', () => {
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'findly-paper-gate-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const commit = () => {
      git('add', '.');
      git(
        '-c',
        'user.name=Synthetic fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      );
    };
    git('init', '--quiet', '--initial-branch=main');
    writeFileSync(join(directory, 'package.json'), JSON.stringify(basePackage));
    mkdirSync(join(directory, 'docs'), { recursive: true });
    writeFileSync(
      join(directory, 'docs', 'paper.md'),
      'Synthetic academic document',
    );
    commit();
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('switch', '--quiet', '--create', 'paper');
    return { directory, git, commit };
  }

  it.each([false, true])(
    'uses the PR merge-base even when upstream has advanced: %s',
    (advanceUpstream) => {
      const { directory, git, commit } = fixture();
      try {
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify(paperPackage),
        );
        writeFileSync(
          join(directory, 'docs', 'paper.md'),
          'Updated synthetic text',
        );
        commit();
        if (advanceUpstream) {
          git('switch', '--quiet', 'main');
          writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
              ...basePackage,
              dependencies: { react: '20.0.0' },
            }),
          );
          commit();
          git('update-ref', 'refs/remotes/origin/main', 'HEAD');
          git('switch', '--quiet', 'paper');
        }
        const output = join(directory, 'gate-output');
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                '../../scripts/check-ephemeral-pr-eligibility.mjs',
                import.meta.url,
              ),
            ),
          ],
          {
            cwd: directory,
            encoding: 'utf8',
            env: {
              ...process.env,
              GITHUB_BASE_REF: 'main',
              PR_AUTHOR: 'anyulled',
              PR_LABELS: '[]',
              PR_TITLE: 'PDF-only fixture',
              GITHUB_OUTPUT: output,
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(output, 'utf8')).toBe('deploy_required=false\n');
        expect(result.stdout).not.toContain('operator-approved skip');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
