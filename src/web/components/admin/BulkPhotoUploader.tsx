import React, { useState } from 'react';
import { uploadFileToS3 } from '../../api';
import type { UploadProgress } from '../../types';

type UploadItem = { file: File; progress: UploadProgress; error?: string };

export function BulkPhotoUploader({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  function update(index: number, progress: UploadProgress, error?: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, progress, error } : item,
      ),
    );
  }

  async function upload(index: number) {
    const item = items[index];
    if (!item) return;
    try {
      await uploadFileToS3(
        `mock://findly/events/${eventId}/photos/${item.file.name}`,
        item.file,
        (progress) => update(index, progress),
      );
    } catch {
      update(
        index,
        { loaded: 0, total: Math.max(item.file.size, 1), percentage: 0 },
        'UPLOAD_FAILED',
      );
    }
  }

  async function startUpload() {
    setIsUploading(true);
    for (let start = 0; start < items.length; start += 3) {
      await Promise.all(
        items
          .slice(start, start + 3)
          .map((_, offset) => upload(start + offset)),
      );
    }
    setIsUploading(false);
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
          accept="image/jpeg,image/png"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setItems(
              files.map((file) => ({
                file,
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
            <div
              className="progress-group"
              key={`${item.file.name}-${item.file.lastModified}`}
            >
              <div className="progress-label">
                <span>{item.file.name}</span>
                <span>{item.progress.percentage}%</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${item.progress.percentage}%` }} />
              </div>
              {item.error && (
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
            {isUploading ? 'Subiendo…' : 'Subir fotografías'}
          </button>
        </div>
      )}
    </section>
  );
}
