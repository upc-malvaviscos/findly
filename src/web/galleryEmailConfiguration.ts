import { executionMode, type ExecutionMode } from './executionMode';

export function resolveGalleryEmailEnabled(
  mode: ExecutionMode,
  requested: string | undefined,
): boolean {
  if (requested !== undefined) return requested === 'true';
  return mode !== 'aws';
}

/** AWS builds require an explicit opt-in matching the deployed email routes. */
export function isGalleryEmailEnabled(): boolean {
  return resolveGalleryEmailEnabled(
    executionMode,
    import.meta.env.VITE_GALLERY_EMAIL_ENABLED,
  );
}
