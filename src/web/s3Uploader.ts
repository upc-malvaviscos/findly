import type { UploadProgress } from './types';

export function uploadFileToS3(
  uploadUrl: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<void> {
  if (uploadUrl.startsWith('mock://')) {
    const total = Math.max(file.size, 1);
    onProgress({ loaded: total, total, percentage: 100 });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
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
    xhr.send(file);
  });
}
