import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BulkPhotoUploader } from '../../src/web/components/admin/BulkPhotoUploader';
import { requestPhotoUploads } from '../../src/web/adminApi';
import { uploadFileToS3 } from '../../src/web/s3Uploader';
import type { PhotoUploadOutcome } from '../../src/shared/types/api';

vi.mock('../../src/web/adminApi', () => ({
  requestPhotoUploads: vi.fn(),
}));
vi.mock('../../src/web/s3Uploader', () => ({
  uploadFileToS3: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

function selectFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error('File input not found');
  fireEvent.change(input, { target: { files } });
}

function outcomesFor(
  files: Array<{ operationId: string; fileName: string }>,
  make: (file: { operationId: string; fileName: string }) => PhotoUploadOutcome,
) {
  return { uploads: files.map(make) };
}

function uploadButton() {
  return screen.getByRole('button', {
    name: /Subir fotografías|Reintentar fallidas/,
  });
}

it('only resends files that have not completed when retrying a partial batch', async () => {
  const ok = new File(['a'], 'ok.jpg', { type: 'image/jpeg' });
  const bad = new File(['b'], 'bad.jpg', { type: 'image/jpeg' });
  vi.mocked(requestPhotoUploads).mockImplementation((_token, _eventId, req) =>
    Promise.resolve(
      outcomesFor(req.files, (file) => ({
        photoId: file.operationId,
        uploadUrl: `https://s3.example.test/${file.operationId}`,
        expiresInSeconds: 300,
      })),
    ),
  );
  // ok.jpg succeeds, bad.jpg fails - keyed by which file is being uploaded.
  vi.mocked(uploadFileToS3).mockImplementation((_url, file) =>
    file.name === 'bad.jpg'
      ? Promise.reject(new Error('UPLOAD_FAILED'))
      : Promise.resolve(),
  );

  render(<BulkPhotoUploader eventId="evt-1" token="token-1" />);
  selectFiles([ok, bad]);
  await act(async () => {
    fireEvent.click(uploadButton());
  });
  await waitFor(() => expect(requestPhotoUploads).toHaveBeenCalledTimes(1));
  expect(screen.getAllByText('No se pudo subir esta fotografía.')).toHaveLength(
    1,
  );

  vi.mocked(requestPhotoUploads).mockClear();
  await act(async () => {
    fireEvent.click(uploadButton());
  });
  await waitFor(() => expect(requestPhotoUploads).toHaveBeenCalledTimes(1));
  const retriedFiles = vi.mocked(requestPhotoUploads).mock.calls[0]?.[2].files;
  expect(retriedFiles).toHaveLength(1);
  expect(retriedFiles?.[0]?.fileName).toBe('bad.jpg');
});

it('keeps two files with the same name as distinct operations', async () => {
  const first = new File(['a'], 'photo.jpg', { type: 'image/jpeg' });
  const second = new File(['b'], 'photo.jpg', { type: 'image/jpeg' });
  vi.mocked(requestPhotoUploads).mockImplementation((_token, _eventId, req) =>
    Promise.resolve(
      outcomesFor(req.files, (file) => ({
        photoId: file.operationId,
        uploadUrl: `https://s3.example.test/${file.operationId}`,
        expiresInSeconds: 300,
      })),
    ),
  );
  vi.mocked(uploadFileToS3).mockResolvedValue(undefined);

  render(<BulkPhotoUploader eventId="evt-1" token="token-1" />);
  selectFiles([first, second]);
  await act(async () => {
    fireEvent.click(uploadButton());
  });
  await waitFor(() => expect(requestPhotoUploads).toHaveBeenCalledTimes(1));
  const sentFiles = vi.mocked(requestPhotoUploads).mock.calls[0]?.[2].files;
  expect(sentFiles).toHaveLength(2);
  expect(sentFiles?.[0]?.operationId).not.toBe(sentFiles?.[1]?.operationId);
  expect(uploadFileToS3).toHaveBeenCalledTimes(2);
});

it('treats a backend-confirmed COMPLETED outcome as success without re-uploading', async () => {
  const file = new File(['a'], 'photo.jpg', { type: 'image/jpeg' });
  vi.mocked(requestPhotoUploads).mockImplementation((_token, _eventId, req) =>
    Promise.resolve(
      outcomesFor(req.files, (f) => ({
        photoId: f.operationId,
        status: 'COMPLETED',
      })),
    ),
  );

  render(<BulkPhotoUploader eventId="evt-1" token="token-1" />);
  selectFiles([file]);
  await act(async () => {
    fireEvent.click(uploadButton());
  });
  await waitFor(() => expect(requestPhotoUploads).toHaveBeenCalledTimes(1));
  expect(uploadFileToS3).not.toHaveBeenCalled();
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(
    screen.queryByText('No se pudo subir esta fotografía.'),
  ).not.toBeInTheDocument();
});

it('uploads at most 3 files concurrently', async () => {
  const files = Array.from(
    { length: 4 },
    (_, index) => new File(['x'], `${index}.jpg`, { type: 'image/jpeg' }),
  );
  vi.mocked(requestPhotoUploads).mockImplementation((_token, _eventId, req) =>
    Promise.resolve(
      outcomesFor(req.files, (f) => ({
        photoId: f.operationId,
        uploadUrl: `https://s3.example.test/${f.operationId}`,
        expiresInSeconds: 300,
      })),
    ),
  );
  let inFlight = 0;
  let maxInFlight = 0;
  const releases: Array<() => void> = [];
  vi.mocked(uploadFileToS3).mockImplementation((_url, _file, onProgress) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((resolve) => {
      releases.push(() => {
        inFlight -= 1;
        onProgress?.({ loaded: 1, total: 1, percentage: 100 });
        resolve();
      });
    });
  });

  render(<BulkPhotoUploader eventId="evt-1" token="token-1" />);
  selectFiles(files);
  act(() => {
    fireEvent.click(uploadButton());
  });
  // Pool processes in batches of 3: the 4th file must not start until the
  // whole first batch has settled, and at no point do more than 3 run.
  await waitFor(() => expect(releases).toHaveLength(3));
  expect(maxInFlight).toBe(3);
  await act(async () => {
    releases.forEach((release) => release());
  });
  await waitFor(() => expect(releases).toHaveLength(4));
  expect(maxInFlight).toBe(3);
  await act(async () => {
    releases[3]?.();
  });
  await waitFor(() => expect(screen.getAllByText('100%')).toHaveLength(4));
});
