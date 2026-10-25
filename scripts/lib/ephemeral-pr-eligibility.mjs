import { isDeepStrictEqual } from 'node:util';

const paperTooling = new Set([
  '.github/workflows/memoria-pdf.yml',
  'scripts/pandoc-container.mjs',
  'scripts/lib/memoria-release.mjs',
  'scripts/lib/memoria-release.d.mts',
  'tests/infra/memoriaRelease.test.ts',
  'scripts/lib/memoria-source.mjs',
  'scripts/lib/memoria-source.d.mts',
  'tests/infra/memoriaSource.test.ts',
]);

/**
 * Utility functions to evaluate whether pull request changes require deploying
 * the ephemeral AWS environment.
 */

/**
 * Returns true if the file path is considered documentation, specification,
 * or repository metadata that does not impact deployable artifacts, infrastructure,
 * or executable code.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isDocumentationFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/').trim();
  if (normalized.length === 0) {
    return false;
  }

  // These tools produce only the academic PDF, not application/AWS artifacts.
  // Keep this list exact: other scripts, workflows and tests remain relevant.
  if (paperTooling.has(normalized)) return true;

  // Documentation and specification directory trees
  if (normalized.startsWith('docs/') || normalized.startsWith('specs/')) {
    return true;
  }

  // Markdown documentation anywhere in the tree
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
    return true;
  }

  // Pure repository text/metadata files
  if (
    normalized === 'LICENSE' ||
    normalized === '.gitignore' ||
    normalized === '.gitattributes' ||
    normalized === '.prettierignore'
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if the list of changed files requires an ephemeral PR deployment.
 *
 * @param {string[]} changedFiles
 * @returns {boolean} true if deployment is required, false if docs-only.
 */
export function requiresEphemeralDeployment(changedFiles, packageChange) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return false;
  }

  return changedFiles.some((file) => {
    if (file === 'package.json')
      return !isPaperOnlyPackageChange(packageChange);
    return !isDocumentationFile(file);
  });
}

function isPaperOnlyPackageChange(change) {
  const isObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const withoutPaperScript = (source) => {
    const manifest = JSON.parse(source);
    if (!isObject(manifest)) throw new Error('Invalid manifest');
    if (manifest.scripts !== undefined && !isObject(manifest.scripts))
      throw new Error('Invalid scripts');
    const scripts = { ...manifest.scripts };
    if (Object.values(scripts).some((value) => typeof value !== 'string'))
      throw new Error('Invalid script command');
    delete scripts['paper:pdf'];
    delete manifest.scripts;
    if (Object.keys(scripts).length > 0) manifest.scripts = scripts;
    return manifest;
  };
  try {
    return isDeepStrictEqual(
      withoutPaperScript(change?.basePackageJson),
      withoutPaperScript(change?.headPackageJson),
    );
  } catch {
    // Missing/unreadable/malformed input must never hide a dependency change.
    return false;
  }
}

/** Explicit operator-reviewed opt-out; ordinary code changes still deploy. */
export function approvedEphemeralSkip(author, labels, title) {
  return (
    ['anyulled', 'orLuzuriaga', 'raati5674', 'surinyach'].includes(author) &&
    ((Array.isArray(labels) && labels.includes('skip-ephemeral-approved')) ||
      (typeof title === 'string' &&
        title.endsWith('[skip-ephemeral-approved]')))
  );
}
