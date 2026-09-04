import type { GalleryResponse } from './types';

const demoGallery: GalleryResponse = {
  eventId: 'demo-2026',
  eventName: 'Findly Demo Night',
  expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  photos: [
    {
      photoId: 'photo-1',
      url: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=900',
      matchedAt: '2026-09-18T20:04:00+02:00',
    },
    {
      photoId: 'photo-2',
      url: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=900',
      matchedAt: '2026-09-18T20:12:00+02:00',
    },
  ],
};

export async function getGallery(token: string): Promise<GalleryResponse> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
  if (token === 'expired') throw new Error('GALLERY_EXPIRED');
  if (token !== 'demo-gallery') throw new Error('GALLERY_NOT_FOUND');
  return demoGallery;
}

export function refreshGallery(token: string) {
  return getGallery(token);
}
