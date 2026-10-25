export function isDocumentationFile(filePath: unknown): boolean;
export function requiresEphemeralDeployment(
  changedFiles: unknown,
  packageChange?: { basePackageJson?: string; headPackageJson?: string },
): boolean;

export function approvedEphemeralSkip(
  author: unknown,
  labels: unknown,
  title?: unknown,
): boolean;
