import React, { useEffect, useRef, useState } from 'react';
import { deleteRegistration } from '../../galleryApi';

type Props = {
  open: boolean;
  token: string;
  registrationId: string;
  onClose: () => void;
  onErased: () => void;
};

export function ErasureModal({
  open,
  token,
  registrationId,
  onClose,
  onErased,
}: Props) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'DELETING' | 'FAILED'>('IDLE');

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && status !== 'DELETING') onClose();
    };
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('keydown', keyHandler);
      previousFocus.current?.focus();
    };
  }, [open, onClose, status]);

  if (!open) return null;

  const confirmErasure = async () => {
    setStatus('DELETING');
    try {
      await deleteRegistration(token, registrationId);
      onErased();
    } catch {
      setStatus('FAILED');
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && status !== 'DELETING')
          onClose();
      }}
    >
      <section
        className="erasure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="erasure-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Privacidad</span>
            <h2 id="erasure-title">Eliminar mis datos</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={status === 'DELETING'}
          >
            ×
          </button>
        </div>
        <p>
          Esta acción es <strong>irreversible</strong>. Eliminaremos tu selfie,
          tu identificador facial y todas las coincidencias encontradas en este
          evento. Dejarás de tener acceso a esta galería.
        </p>
        {status === 'FAILED' ? (
          <p className="field-error" role="alert">
            No hemos podido completar el borrado. Inténtalo de nuevo o contacta
            con el organizador.
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
            disabled={status === 'DELETING'}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => void confirmErasure()}
            disabled={status === 'DELETING'}
          >
            {status === 'DELETING' ? 'Eliminando…' : 'Confirmar borrado'}
          </button>
        </div>
      </section>
    </div>
  );
}
