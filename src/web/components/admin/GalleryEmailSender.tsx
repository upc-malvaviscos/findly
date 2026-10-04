import { useEffect, useRef, useState } from 'react';
import { getGalleryEmailStatus, requestGalleryEmail } from '../../adminApi';
import { isGalleryEmailEnabled } from '../../galleryEmailConfiguration';
import type { GalleryEmailOperation } from '../../../shared/types/api';

export function GalleryEmailSender(props: { eventId: string; token: string }) {
  return isGalleryEmailEnabled() ? (
    <EnabledGalleryEmailSender {...props} />
  ) : (
    <section aria-labelledby="gallery-email-title">
      <h3 id="gallery-email-title">Enviar galerías por email</h3>
      <p>El envío por email aún no está disponible.</p>
    </section>
  );
}

function EnabledGalleryEmailSender({
  eventId,
  token,
}: {
  eventId: string;
  token: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<GalleryEmailOperation | null>(
    null,
  );
  const [error, setError] = useState('');
  const pendingId = useRef<string | null>(null);
  const locked = useRef(false);
  const operationId = operation?.operationId;
  const operationStatus = operation?.status;
  useEffect(() => {
    if (!operationId || operationStatus === 'COMPLETED') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getGalleryEmailStatus(token, eventId, operationId);
        if (cancelled) return;
        setOperation(next);
        setError('');
        if (next.status === 'COMPLETED') {
          pendingId.current = null;
          return;
        }
      } catch {
        if (cancelled) return;
        setError('No se pudo consultar el progreso. Seguimos comprobándolo.');
      }
      timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eventId, token, operationId, operationStatus]);
  async function send() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    pendingId.current ??= crypto.randomUUID();
    try {
      const next = await requestGalleryEmail(token, eventId, pendingId.current);
      setOperation(next);
      setConfirmed(false);
      if (next.status === 'COMPLETED') pendingId.current = null;
    } catch {
      setConfirmed(false);
      setError(
        'No se pudo confirmar la solicitud. Reintentar conserva el mismo envío.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="gallery-email-title">
      <h3 id="gallery-email-title">Enviar galerías por email</h3>
      <p>
        Cada envío incluye a todos los participantes vigentes con email y
        fotografías disponibles, aunque ya recibieran otro correo.
      </p>
      {operation ? (
        <div role="status" aria-live="polite">
          <p>
            {operation.status === 'COMPLETED'
              ? 'Envío finalizado'
              : operation.status === 'STALLED'
                ? 'Envío sin avance. Reintenta la misma solicitud o revisa la cola de errores.'
                : 'Envío en curso'}
          </p>
          <p>
            Aceptados por SES: {operation.accepted} · Omitidos:{' '}
            {operation.skipped} · Sin email válido: {operation.missingEmail} ·
            Fallidos: {operation.failed} · Resultado incierto:{' '}
            {operation.uncertain}
          </p>
          <p>
            Rebotes permanentes: {operation.bounced} · Quejas:{' '}
            {operation.complained}
          </p>
        </div>
      ) : null}
      <p>
        La aceptación de SES no confirma la entrega al buzón. Los resultados
        inciertos no se reenvían automáticamente.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {confirmed ? (
        <div>
          <p>
            ¿Confirmas el envío a todos los participantes elegibles de este
            evento?
          </p>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void send()}
          >
            Confirmar envío
          </button>
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={() => setConfirmed(false)}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          className="button button-primary"
          disabled={busy || operation?.status === 'RUNNING'}
          onClick={() => setConfirmed(true)}
        >
          {(error && !operation) || operation?.status === 'STALLED'
            ? 'Reintentar solicitud'
            : 'Enviar galerías'}
        </button>
      )}
    </section>
  );
}
