const JPEG_MIME_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.92;

export function needsJpegConversion(file: File): boolean {
  return file.type !== JPEG_MIME_TYPE;
}

export async function ensureJpegFile(file: File): Promise<File> {
  if (!needsJpegConversion(file)) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, JPEG_MIME_TYPE, JPEG_QUALITY),
  );
  if (!blob) throw new Error('JPEG_CONVERSION_FAILED');

  const jpegName = `${file.name.replace(/\.[^./\\]+$/, '')}.jpg`;
  return new File([blob], jpegName, { type: JPEG_MIME_TYPE });
}
