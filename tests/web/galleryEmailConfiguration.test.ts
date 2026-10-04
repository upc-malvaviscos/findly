import { expect, it } from 'vitest';
import { resolveGalleryEmailEnabled } from '../../src/web/galleryEmailConfiguration';

it('requires explicit opt-in for AWS and preserves local defaults', () => {
  expect(resolveGalleryEmailEnabled('aws', undefined)).toBe(false);
  expect(resolveGalleryEmailEnabled('aws', 'false')).toBe(false);
  expect(resolveGalleryEmailEnabled('aws', 'TRUE')).toBe(false);
  expect(resolveGalleryEmailEnabled('aws', 'true')).toBe(true);
  expect(resolveGalleryEmailEnabled('mock', undefined)).toBe(true);
  expect(resolveGalleryEmailEnabled('floci', undefined)).toBe(true);
  expect(resolveGalleryEmailEnabled('mock', 'false')).toBe(false);
  expect(resolveGalleryEmailEnabled('floci', 'false')).toBe(false);
});
