import React, { useEffect, useState } from 'react';
import { getGallery, refreshGallery } from '../../galleryApi';
import type { GalleryPhoto, GalleryResponse } from '../../types';

type GalleryState = 'LOADING' | 'SUCCESS' | 'EMPTY' | 'EXPIRED' | 'NOT_FOUND';

export function GalleryPage({ token }: { token: string }) {
  const [state, setState] = useState<GalleryState>('LOADING');
  const [gallery, setGallery] = useState<GalleryResponse | null>(null);
  const [selected, setSelected] = useState<GalleryPhoto | null>(null);

  useEffect(() => {
    let active = true;
    void getGallery(token)
      .then((result) => {
        if (!active) return;
        setGallery(result);
        setState(result.photos.length === 0 ? 'EMPTY' : 'SUCCESS');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof Error && error.message === 'GALLERY_EXPIRED'
            ? 'EXPIRED'
            : 'NOT_FOUND',
        );
      });
    const timer = window.setInterval(
      () => {
        void refreshGallery(token)
          .then((result) => {
            if (active) setGallery(result);
          })
          .catch(() => undefined);
      },
      4 * 60 * 1000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token]);

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
  if (state === 'EMPTY' || gallery === null)
    return (
      <main className="page-shell">
        <section className="enrollment-card">
          <h1>Aún no hay fotos.</h1>
          <p>Te avisaremos cuando haya fotografías disponibles.</p>
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
        <div className="gallery-grid">
          {gallery.photos.map((photo) => (
            <button
              className="gallery-photo"
              key={photo.photoId}
              onClick={() => setSelected(photo)}
            >
              <img src={photo.url} alt="Fotografía del evento" loading="lazy" />
              <span className="visually-hidden">Abrir fotografía</span>
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
              href={selected.url}
              download
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Descargar
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
