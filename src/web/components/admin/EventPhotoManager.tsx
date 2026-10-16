import { useEffect, useState } from 'react';
import { deleteEventPhoto, getEventPhotos } from '../../adminApi';
import type { EventPhoto } from '../../../shared/types/api';

export function EventPhotoManager({
  eventId,
  token,
}: {
  eventId: string;
  token: string;
}) {
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingPhotoId, setConfirmingPhotoId] = useState<string | null>(
    null,
  );
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  useEffect(() => {
    // The parent keys this component by eventId, remounting it (and
    // resetting all state to its initial values) on every event change;
    // this effect only has to run the fetch, never reset state itself.
    let cancelled = false;
    getEventPhotos(token, eventId)
      .then((page) => {
        if (cancelled) return;
        setPhotos(page.photos);
        setNextCursor(page.nextCursor);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('No se pudieron cargar las fotografías.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, token]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await getEventPhotos(token, eventId, nextCursor);
      setPhotos((current) => [...current, ...page.photos]);
      setNextCursor(page.nextCursor);
    } catch {
      setError('No se pudieron cargar más fotografías.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete(photoId: string) {
    setDeletingPhotoId(photoId);
    setError('');
    try {
      await deleteEventPhoto(token, eventId, photoId);
      setPhotos((current) =>
        current.filter((photo) => photo.photoId !== photoId),
      );
      setConfirmingPhotoId(null);
    } catch {
      setError('No se pudo eliminar la fotografía. Inténtalo de nuevo.');
    } finally {
      setDeletingPhotoId(null);
    }
  }

  return (
    <section aria-labelledby="event-photos-title">
      <h3 id="event-photos-title">Fotografías del evento</h3>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {photos.length === 0 && !loading ? (
        <p>No hay fotografías todavía.</p>
      ) : (
        <ul className="event-photo-list">
          {photos.map((photo) => (
            <li key={photo.photoId} className="event-photo-row">
              <span>{photo.photoId}</span>
              {confirmingPhotoId === photo.photoId ? (
                <span>
                  <span>¿Eliminar esta fotografía?</span>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={deletingPhotoId === photo.photoId}
                    onClick={() => void confirmDelete(photo.photoId)}
                  >
                    {deletingPhotoId === photo.photoId
                      ? 'Eliminando…'
                      : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={deletingPhotoId === photo.photoId}
                    onClick={() => setConfirmingPhotoId(null)}
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setConfirmingPhotoId(photo.photoId)}
                >
                  Eliminar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {loading ? <p>Cargando…</p> : null}
      {nextCursor ? (
        <button
          type="button"
          className="button button-quiet"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          Cargar más fotografías
        </button>
      ) : null}
    </section>
  );
}
