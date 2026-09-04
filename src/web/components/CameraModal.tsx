import React, { useEffect, useRef, useState } from 'react';
type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
};
export function CameraModal({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Tu navegador no permite usar la cámara. Selecciona una foto de tu dispositivo.',
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        if (cancelled) stream.getTracks().forEach((track) => track.stop());
        else if (video) video.srcObject = stream;
      } catch {
        setError(
          'No hemos podido acceder a la cámara. Puedes seleccionar una foto de tu dispositivo.',
        );
      }
    };
    void start();
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', keyHandler);
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      document.removeEventListener('keydown', keyHandler);
      previousFocus.current?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  const capture = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setError('Espera un momento a que la cámara esté lista.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          onCapture(
            new File([blob], `findly-selfie-${Date.now()}.jpg`, {
              type: 'image/jpeg',
            }),
          );
      },
      'image/jpeg',
      0.9,
    );
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="camera-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Captura</span>
            <h2 id="camera-title">Hazte una foto</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar cámara"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {error ? (
          <p className="camera-error" role="alert">
            {error}
          </p>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-video"
            aria-label="Vista de la cámara"
          />
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={capture}
            disabled={Boolean(error)}
          >
            Capturar selfie
          </button>
        </div>
      </section>
    </div>
  );
}
