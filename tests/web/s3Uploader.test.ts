import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFileToS3 } from '../../src/web/s3Uploader';

class MockXhr {
  static instances: MockXhr[] = [];
  method = '';
  url = '';
  status = 200;
  requestHeaders: Record<string, string> = {};
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    MockXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  send() {
    // no-op: the test drives onprogress/onload/onerror manually
  }
}

function getXhr(): MockXhr {
  const xhr = MockXhr.instances[0];
  if (!xhr) throw new Error('Expected an XHR instance to have been created');
  return xhr;
}

describe('uploadFileToS3', () => {
  afterEach(() => {
    MockXhr.instances = [];
    vi.unstubAllGlobals();
  });

  it('PUTs the file with a matching Content-Type and reports progress', async () => {
    vi.stubGlobal(
      'XMLHttpRequest',
      MockXhr as unknown as typeof XMLHttpRequest,
    );
    const file = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' });
    const onProgress = vi.fn();

    const uploadPromise = uploadFileToS3(
      'https://s3.example.com/signed-put',
      file,
      onProgress,
    );

    const xhr = getXhr();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://s3.example.com/signed-put');
    expect(xhr.requestHeaders['Content-Type']).toBe('image/jpeg');

    xhr.upload.onprogress?.({
      lengthComputable: true,
      loaded: 3,
      total: 6,
    } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 3,
      total: 6,
      percentage: 50,
    });

    xhr.status = 200;
    xhr.onload?.();

    await expect(uploadPromise).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: file.size,
      total: file.size,
      percentage: 100,
    });
  });

  it('rejects when S3 responds with a non-2xx status', async () => {
    vi.stubGlobal(
      'XMLHttpRequest',
      MockXhr as unknown as typeof XMLHttpRequest,
    );
    const file = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' });

    const uploadPromise = uploadFileToS3(
      'https://s3.example.com/signed-put',
      file,
      vi.fn(),
    );
    const xhr = getXhr();
    xhr.status = 403;
    xhr.onload?.();

    await expect(uploadPromise).rejects.toThrow('UPLOAD_FAILED_403');
  });

  it('rejects on a network error', async () => {
    vi.stubGlobal(
      'XMLHttpRequest',
      MockXhr as unknown as typeof XMLHttpRequest,
    );
    const file = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' });

    const uploadPromise = uploadFileToS3(
      'https://s3.example.com/signed-put',
      file,
      vi.fn(),
    );
    getXhr().onerror?.();

    await expect(uploadPromise).rejects.toThrow('UPLOAD_FAILED');
  });
});
