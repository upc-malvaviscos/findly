const MISSING_RESOURCE_ERROR_NAMES = new Set([
  'ResourceNotFoundException',
  'InvalidParameterException',
  'NoSuchKey',
  // HeadObjectCommand's modeled 404, used by createPhotoUploads (#121) to
  // tell an unconfirmed retry from a confirmed-complete one.
  'NotFound',
]);

export function isMissingResourceError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name !== undefined && MISSING_RESOURCE_ERROR_NAMES.has(name);
}
