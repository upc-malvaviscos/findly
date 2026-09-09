import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureJpegFile, needsJpegConversion } from '../../src/web/imageConversion';

describe('needsJpegConversion', () => {
  it('returns false for an already-JPEG file', () => {
    const file = new File(['data'], 'selfie.jpg', { type: 'image/jpeg' });
    expect(needsJpegConversion(file)).toBe(false);
  });

  it('returns true for a non-JPEG file', () => {
    const file = new File(['data'], 'selfie.png', { type: 'image/png' });
    expect(needsJpegConversion(file)).toBe(true);
  });
});

describe('ensureJpegFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the original file unchanged when it is already JPEG', async () => {
    const file = new File(['data'], 'selfie.jpg', { type: 'image/jpeg' });
    const result = await ensureJpegFile(file);
    expect(result).toBe(file);
  });

  it('converts a non-JPEG file to a JPEG File via canvas', async () => {
    const jpegBlob = new Blob(['converted'], { type: 'image/jpeg' });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }),
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback) => callback(jpegBlob),
    );

    const file = new File(['data'], 'selfie.png', { type: 'image/png' });
    const result = await ensureJpegFile(file);

    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('selfie.jpg');
    expect(drawImage).toHaveBeenCalled();
  });

  it('throws when the canvas cannot produce a blob', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback) => callback(null),
    );

    const file = new File(['data'], 'selfie.webp', { type: 'image/webp' });
    await expect(ensureJpegFile(file)).rejects.toThrow('JPEG_CONVERSION_FAILED');
  });
});
