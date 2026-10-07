import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getGallery, refreshGallery } from '../../galleryApi';
import type { GalleryPhoto, GalleryResponse } from '../../types';
import { ErasureModal } from './ErasureModal';

type GalleryState =
  'LOADING' | 'SUCCESS' | 'EMPTY' | 'EXPIRED' | 'NOT_FOUND' | 'ERASED';

const REFRESH_INTERVAL_MS = 4 * 60 * 1000;

function terminalStateFor(error: unknown): 'EXPIRED' | 'NOT_FOUND' | null {
  if (!(error instanceof Error)) return 'NOT_FOUND';
  if (error.message === 'GALLERY_EXPIRED') return 'EXPIRED';
  if (error.message === 'GALLERY_NOT_FOUND') return 'NOT_FOUND';
  return null;
}

function galleryShareUrl(token: string): string {
  return `${window.location.origin}/gallery?token=${encodeURIComponent(token)}`;
}

export function GalleryPage({ token }: { token: string }) {
  const [state, setState] = useState<GalleryState>('LOADING');
  const [gallery, setGallery] = useState<GalleryResponse | null>(null);
  const [selected, setSelected] = useState<GalleryPhoto | null>(null);
  const [erasureOpen, setErasureOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const activeRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const stopPeriodicRefresh = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const applyRefreshResult = useCallback((result: GalleryResponse) => {
    if (!activeRef.current) return;
    setGallery(result);
    setState((current) =>
      current === 'ERASED'
        ? current
        : result.photos.length === 0
          ? 'EMPTY'
          : 'SUCCESS',
    );
  }, []);

  const applyRefreshFailure = useCallback(
    (thrown: unknown) => {
      if (!activeRef.current) return;
      const terminal = terminalStateFor(thrown);
      if (terminal) {
        stopPeriodicRefresh();
        setState(terminal);
      }
      return terminal;
    },
    [stopPeriodicRefresh],
  );

  useEffect(() => {
    activeRef.current = true;
    void getGallery(token)
      .then(applyRefreshResult)
      .catch((thrownError: unknown) => {
        if (!activeRef.current) return;
        setState(terminalStateFor(thrownError) ?? 'NOT_FOUND');
      });
    timerRef.current = window.setInterval(() => {
      void refreshGallery(token)
        .then(applyRefreshResult)
        .catch(applyRefreshFailure);
    }, REFRESH_INTERVAL_MS);
    return () => {
      activeRef.current = false;
      stopPeriodicRefresh();
    };
  }, [token, applyRefreshResult, applyRefreshFailure, stopPeriodicRefresh]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    void refreshGallery(token)
      .then((result) => {
        setRefreshing(false);
        applyRefreshResult(result);
      })
      .catch((thrownError: unknown) => {
        setRefreshing(false);
        const terminal = applyRefreshFailure(thrownError);
        if (!terminal) setRefreshError('No hemos podido actualizar tus fotos.');
      });
  };

  const handleShare = () => {
    const url = galleryShareUrl(token);
    void navigator.clipboard
      .writeText(url)
      .then(() => setShareStatus('copied'))
      .catch(() => setShareStatus('error'));
  };

  if (state === 'LOADING')
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <p role="status">Cargando tu galería…</p>
        </section>
      </main>
    );
  if (state === 'EXPIRED')
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <h1>Enlace caducado.</h1>
          <p>Solicita un nuevo enlace para volver a ver tus fotografías.</p>
        </section>
      </main>
    );
  if (state === 'NOT_FOUND')
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <h1>Galería no encontrada.</h1>
          <p>Comprueba que has usado el enlace recibido por email.</p>
        </section>
      </main>
    );
  if (state === 'ERASED')
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <h1>Tus datos han sido eliminados.</h1>
          <p>
            Hemos borrado tu selfie, tu identificador facial y tus coincidencias
            de este evento. Este enlace ya no funcionará.
          </p>
        </section>
      </main>
    );
  const shareControls = gallery ? (
    <div className="gallery-share">
      <button type="button" className="text-button" onClick={handleShare}>
        Copiar enlace de la galería
      </button>
      <p className="hint-text">
        Quien reciba este enlace podrá ver, descargar y también eliminar tus
        datos con «Eliminar mis datos». Compartirlo no amplía el tiempo de
        conservación de tus fotos.
      </p>
      {shareStatus === 'copied' && <p role="status">Enlace copiado.</p>}
      {shareStatus === 'error' && (
        <p role="alert">No hemos podido copiar el enlace.</p>
      )}
    </div>
  ) : null;
  if (state === 'EMPTY' || gallery === null)
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <h1>Aún no hay fotos.</h1>
          <p>Te avisaremos cuando haya fotografías disponibles.</p>
          {gallery ? (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleManualRefresh}
                disabled={refreshing}
              >
                {refreshing ? 'Actualizando…' : 'Actualizar fotos'}
              </button>
              {refreshError && <p role="alert">{refreshError}</p>}
              {shareControls}
              <button
                type="button"
                className="text-button"
                onClick={() => setErasureOpen(true)}
              >
                Eliminar mis datos
              </button>
              <ErasureModal
                open={erasureOpen}
                token={token}
                registrationId={gallery.registrationId}
                onClose={() => setErasureOpen(false)}
                onErased={() => {
                  setErasureOpen(false);
                  setState('ERASED');
                }}
              />
            </>
          ) : null}
        </section>
      </main>
    );
  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="brand">
          <span className="brand-mark">/</span> Findly
        </div>
        <span className="header-note">Galería privada</span>
      </header>
      <section className="enrollment-card gallery-card">
        <span className="eyebrow">Tus recuerdos</span>
        <h1>{gallery.eventName}.</h1>
        <div className="gallery-toolbar">
          <button
            type="button"
            className="button button-secondary"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Actualizando…' : 'Actualizar fotos'}
          </button>
          {refreshError && <p role="alert">{refreshError}</p>}
        </div>
        <div className="gallery-grid">
          {gallery.photos.map((photo) => (
            <button
              className="gallery-photo"
              key={photo.photoId}
              aria-label="Abrir fotografía"
              onClick={() => setSelected(photo)}
            >
              <img src={photo.url} alt="Fotografía del evento" loading="lazy" />
            </button>
          ))}
        </div>
        {selected && (
          <div
            className="lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Visor de fotografía"
            onClick={() => setSelected(null)}
          >
            <img src={selected.url} alt="Fotografía ampliada del evento" />
            <a
              className="button button-primary"
              href={selected.downloadUrl}
              download
              onClick={(event) => event.stopPropagation()}
            >
              Descargar
            </a>
          </div>
        )}
        {shareControls}
        <div className="gallery-footer">
          <button
            type="button"
            className="text-button"
            onClick={() => setErasureOpen(true)}
          >
            Eliminar mis datos
          </button>
        </div>
        <ErasureModal
          open={erasureOpen}
          token={token}
          registrationId={gallery.registrationId}
          onClose={() => setErasureOpen(false)}
          onErased={() => {
            setErasureOpen(false);
            setState('ERASED');
          }}
        />
      </section>
    </main>
  );
}
