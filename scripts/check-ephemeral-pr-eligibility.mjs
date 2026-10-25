#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  approvedEphemeralSkip,
  requiresEphemeralDeployment,
} from './lib/ephemeral-pr-eligibility.mjs';

const baseRef = process.env.GITHUB_BASE_REF || 'main';

let changedFiles = [];
let comparisonBase = `origin/${baseRef}`;
let compareMergeBase = true;
try {
  const diffOutput = execFileSync(
    'git',
    ['diff', '--name-only', `origin/${baseRef}...HEAD`],
    { encoding: 'utf8' },
  );
  changedFiles = diffOutput.split('\n').filter(Boolean);
} catch (error) {
  console.warn(
    `Warning: git diff against origin/${baseRef} failed: ${error.message}. Attempting fallback...`,
  );
  try {
    const fallbackOutput = execFileSync(
      'git',
      ['diff', '--name-only', 'HEAD~1...HEAD'],
      { encoding: 'utf8' },
    );
    changedFiles = fallbackOutput.split('\n').filter(Boolean);
    comparisonBase = 'HEAD~1';
    compareMergeBase = false;
  } catch (fallbackError) {
    console.warn(
      `Warning: fallback git diff failed: ${fallbackError.message}.`,
    );
    // Safe default: require deployment if diff fails
    changedFiles = ['UNKNOWN_CHANGE_FALLBACK_TRIGGER'];
  }
}

let packageChange;
if (changedFiles.includes('package.json')) {
  try {
    // Compare the same ancestor used by the three-dot PR diff, not origin/main's
    // current tip: upstream may have changed dependencies after this PR branched.
    const ancestor = compareMergeBase
      ? execFileSync('git', ['merge-base', comparisonBase, 'HEAD'], {
          encoding: 'utf8',
        }).trim()
      : comparisonBase;
    packageChange = {
      basePackageJson: execFileSync(
        'git',
        ['show', `${ancestor}:package.json`],
        { encoding: 'utf8' },
      ),
      headPackageJson: execFileSync('git', ['show', 'HEAD:package.json'], {
        encoding: 'utf8',
      }),
    };
  } catch {
    console.warn(
      'Unable to compare package.json revisions; requiring AWS validation for that file.',
    );
  }
}

console.log(`Evaluated ${changedFiles.length} changed file(s):`);
for (const file of changedFiles) {
  console.log(`  - ${file}`);
}

let labels = [];
try {
  labels = JSON.parse(process.env.PR_LABELS ?? '[]');
} catch {
  /* Fail closed: regular deployment eligibility applies. */
}
const approvedSkip = approvedEphemeralSkip(
  process.env.PR_AUTHOR,
  labels,
  process.env.PR_TITLE,
);
const deployRequired =
  !approvedSkip && requiresEphemeralDeployment(changedFiles, packageChange);

if (deployRequired) {
  console.log(
    '::notice::Executable code, infrastructure, or configuration changes detected. Ephemeral PR environment deployment is required.',
  );
} else if (approvedSkip) {
  console.log(
    '::notice::Explicit operator-approved skip of ephemeral AWS deployment; local and CI checks still apply.',
  );
} else {
  console.log(
    '::notice::Changes affect only documentation or PDF tooling. Skipping ephemeral environment deployment.',
  );
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `deploy_required=${deployRequired}\n`,
  );
}
