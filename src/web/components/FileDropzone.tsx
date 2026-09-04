import React, { useEffect, useRef, useState } from 'react';

type Props = {
  file: File | null;
  previewUrl: string | null;
  error?: string;
  onFileSelected: (file: File | null) => void;
  onOpenCamera: () => void;
};
export function FileDropzone({
  file,
  previewUrl,
  error,
  onFileSelected,
  onOpenCamera,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [safePreviewUrl, setSafePreviewUrl] = useState<string | null>(null);
  const choose = (next: File | null) => onFileSelected(next);

  useEffect(() => {
    if (!file) {
      setSafePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSafePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <div className="upload-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">02 · Tu selfie</span>
          <h2>Elige tu mejor retrato</h2>
        </div>
        <span className="required-mark">Obligatorio</span>
      </div>
      <div
        className={`dropzone${dragActive ? ' is-dragging' : ''}${error ? ' has-error' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          choose(event.dataTransfer.files[0] ?? null);
        }}
      >
        {safePreviewUrl && file ? (
          <div className="preview-wrap">
            <img
              src={safePreviewUrl}
              alt="Vista previa de tu selfie"
              className="selfie-preview"
            />
            <div className="preview-meta">
              <strong>{file.name}</strong>
              <span>{Math.ceil(file.size / 1024)} KB</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => inputRef.current?.click()}
            >
              Elegir otra imagen
            </button>
          </div>
        ) : (
          <>
            <div className="upload-icon" aria-hidden="true">
              +
            </div>
            <p className="dropzone-title">Arrastra una imagen aquí</p>
            <p className="dropzone-copy">o selecciónala desde tu dispositivo</p>
            <div className="upload-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => inputRef.current?.click()}
              >
                Seleccionar foto
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={onOpenCamera}
              >
                Usar cámara
              </button>
            </div>
            <p className="field-help">JPG, PNG o WEBP · Máximo 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
