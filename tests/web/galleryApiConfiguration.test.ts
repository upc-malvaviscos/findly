import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it('fails closed for gallery and erasure in AWS mode without backend configuration', async () => {
  vi.stubEnv('VITE_FINDLY_EXECUTION_MODE', 'aws');
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.resetModules();
  const { getGallery, deleteRegistration } =
    await import('../../src/web/galleryApi');
  await expect(getGallery('demo-gallery')).rejects.toThrow(
    'BACKEND_NOT_CONFIGURED',
  );
  await expect(
    deleteRegistration('demo-gallery', 'registration-demo'),
  ).rejects.toThrow('BACKEND_NOT_CONFIGURED');
});
