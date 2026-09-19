import type { UploadProgress } from './types';

// Presigned URLs live at most 300 s; a stalled PUT must fail well before that.
export const UPLOAD_TIMEOUT_MS = 60_000;

export function uploadFileToS3(
  uploadUrl: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('UPLOAD_ABORTED'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percentage: Math.round((event.loaded / event.total) * 100),
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ loaded: file.size, total: file.size, percentage: 100 });
        resolve();
      } else {
        reject(new Error(`UPLOAD_FAILED_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('UPLOAD_FAILED'));
    xhr.ontimeout = () => reject(new Error('UPLOAD_TIMEOUT'));
    xhr.onabort = () => reject(new Error('UPLOAD_ABORTED'));
    xhr.send(file);
  });
}
