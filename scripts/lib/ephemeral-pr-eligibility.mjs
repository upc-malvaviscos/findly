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
export function requiresEphemeralDeployment(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return false;
  }

  return changedFiles.some((file) => !isDocumentationFile(file));
}
