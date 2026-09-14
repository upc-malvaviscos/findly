const MISSING_RESOURCE_ERROR_NAMES = new Set([
  'ResourceNotFoundException',
  'InvalidParameterException',
  'NoSuchKey',
]);

export function isMissingResourceError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name !== undefined && MISSING_RESOURCE_ERROR_NAMES.has(name);
}
