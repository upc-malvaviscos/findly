import React, { useState } from 'react';
import { uploadFileToS3 } from '../../s3Uploader';
import { requestPhotoUploads } from '../../adminApi';
import type { UploadProgress } from '../../types';

type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

type UploadItem = {
  file: File;
  operationId: string;
  status: UploadStatus;
  progress: UploadProgress;
  error?: string;
};

const CONCURRENCY = 3;

export function BulkPhotoUploader({
  eventId,
  token,
}: {
  eventId: string;
  token: string;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  function update(operationId: string, patch: Partial<UploadItem>) {
    setItems((current) =>
      current.map((item) =>
        item.operationId === operationId ? { ...item, ...patch } : item,
      ),
    );
  }

  async function uploadOne(item: UploadItem, uploadUrl: string) {
    update(item.operationId, { status: 'uploading', error: undefined });
    try {
      await uploadFileToS3(uploadUrl, item.file, (progress) =>
        update(item.operationId, { progress }),
      );
      update(item.operationId, { status: 'completed' });
    } catch {
      update(item.operationId, {
        status: 'failed',
        progress: {
          loaded: 0,
          total: Math.max(item.file.size, 1),
          percentage: 0,
        },
        error: 'UPLOAD_FAILED',
      });
    }
  }

  async function startUpload() {
    setIsUploading(true);
    try {
      const pending = items.filter(
        (item) =>
          item.status !== 'completed' && item.file.type === 'image/jpeg',
      );
      const rejected = items.filter(
        (item) =>
          item.status !== 'completed' && item.file.type !== 'image/jpeg',
      );
      if (rejected.length > 0) {
        setItems((current) =>
          current.map((item) =>
            rejected.includes(item)
              ? { ...item, status: 'failed', error: 'INVALID_FILE_TYPE' }
              : item,
          ),
        );
      }
      if (pending.length === 0) return;
      const { uploads } = await requestPhotoUploads(token, eventId, {
        files: pending.map((item) => ({
          operationId: item.operationId,
          fileName: item.file.name,
          contentType: 'image/jpeg',
        })),
      });
      const outcomeByOperationId = new Map(
        uploads.map((outcome) => [outcome.photoId, outcome]),
      );
      for (let start = 0; start < pending.length; start += CONCURRENCY) {
        await Promise.all(
          pending.slice(start, start + CONCURRENCY).map(async (item) => {
            const outcome = outcomeByOperationId.get(item.operationId);
            if (!outcome) {
              update(item.operationId, {
                status: 'failed',
                error: 'UPLOAD_REQUEST_FAILED',
              });
              return;
            }
            if ('status' in outcome && outcome.status === 'COMPLETED') {
              // Backend-confirmed via S3 HeadObject: a prior PUT already
              // succeeded even though this client never saw that response.
              // 100% client-side progress is never treated as confirmation
              // on its own - only this, or a successful PUT response, is.
              update(item.operationId, {
                status: 'completed',
                progress: {
                  loaded: item.file.size,
                  total: Math.max(item.file.size, 1),
                  percentage: 100,
                },
              });
              return;
            }
            if ('error' in outcome) {
              update(item.operationId, {
                status: 'failed',
                error: outcome.error,
              });
              return;
            }
            if ('uploadUrl' in outcome)
              await uploadOne(item, outcome.uploadUrl);
          }),
        );
      }
    } catch {
      setItems((current) =>
        current.map((item) =>
          item.status === 'completed'
            ? item
            : {
                ...item,
                status: 'failed',
                error: item.error ?? 'UPLOAD_REQUEST_FAILED',
              },
        ),
      );
    } finally {
      setIsUploading(false);
    }
  }

  const overall =
    items.length === 0
      ? 0
      : Math.round(
          items.reduce((sum, item) => sum + item.progress.percentage, 0) /
            items.length,
        );

  return (
    <section aria-labelledby="bulk-upload-title">
      <h2 id="bulk-upload-title">Subir fotos del evento</h2>
      <label className="field">
        <span>Fotografías</span>
        <input
          type="file"
          accept="image/jpeg"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setItems(
              files.map((file) => ({
                file,
                operationId: crypto.randomUUID(),
                status: 'pending',
                progress: {
                  loaded: 0,
                  total: Math.max(file.size, 1),
                  percentage: 0,
                },
              })),
            );
          }}
        />
      </label>
      {items.length > 0 && (
        <div aria-live="polite">
          <p>Progreso global: {overall}%</p>
          {items.map((item) => (
            <div className="progress-group" key={item.operationId}>
              <div className="progress-label">
                <span>{item.file.name}</span>
                <span>{item.progress.percentage}%</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${item.progress.percentage}%` }} />
              </div>
              {item.status === 'failed' && (
                <p className="field-error">No se pudo subir esta fotografía.</p>
              )}
            </div>
          ))}
          <button
            className="button button-primary button-submit"
            type="button"
            disabled={isUploading}
            onClick={() => void startUpload()}
          >
            {isUploading
              ? 'Subiendo…'
              : items.some((item) => item.status === 'failed')
                ? 'Reintentar fallidas'
                : 'Subir fotografías'}
          </button>
        </div>
      )}
    </section>
  );
}
