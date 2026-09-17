import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GalleryPage } from '../../src/web/components/gallery/GalleryPage';
import * as galleryApi from '../../src/web/galleryApi';
import type { GalleryResponse } from '../../src/web/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GalleryPage', () => {
  it('renders matched photos and handles the lightbox', async () => {
    render(<GalleryPage token="demo-gallery" />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Findly Demo Night/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getAllByRole('img', { name: 'Fotografía del evento' }),
    ).toHaveLength(2);
  });

  it('completes the erasure flow and shows the confirmation state', async () => {
    render(<GalleryPage token="demo-gallery" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Findly Demo Night/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mis datos' }));
    expect(
      screen.getByRole('dialog', { name: 'Eliminar mis datos' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar borrado' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          name: 'Tus datos han sido eliminados.',
        }),
      ).toBeInTheDocument(),
    );
  });

  it('shows a retry-safe error when erasure fails', async () => {
    render(<GalleryPage token="demo-gallery-fail-erasure" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Findly Demo Night/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mis datos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar borrado' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No hemos podido completar el borrado',
    );
    expect(
      screen.getByRole('dialog', { name: 'Eliminar mis datos' }),
    ).toBeInTheDocument();
  });

  it('closes the erasure modal on cancel without deleting anything', async () => {
    render(<GalleryPage token="demo-gallery" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Findly Demo Night/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mis datos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(
      screen.queryByRole('dialog', { name: 'Eliminar mis datos' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Findly Demo Night/ }),
    ).toBeInTheDocument();
  });

  it('shows a safe error state for expired links', async () => {
    render(<GalleryPage token="expired" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Enlace caducado.' }),
      ).toBeInTheDocument(),
    );
  });

  it('shows not found for invalid links', async () => {
    render(<GalleryPage token="invalid" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Galería no encontrada.' }),
      ).toBeInTheDocument(),
    );
  });

  it('shows the visible empty state for a valid gallery without photos', async () => {
    render(<GalleryPage token="demo-gallery-empty" />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Aún no hay fotos.' }),
      ).toBeInTheDocument(),
    );
  });

  it('renders a real download control in the lightbox', async () => {
    render(<GalleryPage token="demo-gallery" />);
    await screen.findByRole('heading', { name: /Findly Demo Night/ });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Abrir fotografía' })[0]!,
    );
    const download = screen.getByRole('link', { name: 'Descargar' });
    expect(download).toHaveAttribute('download');
    expect(download).toHaveAttribute(
      'href',
      expect.stringContaining('images.unsplash.com'),
    );
  });

  it('refreshes gallery URLs after four minutes', async () => {
    vi.useFakeTimers();
    const initial: GalleryResponse = {
      eventId: 'demo-2026',
      eventName: 'Initial event',
      registrationId: 'registration-demo',
      expiresAt: '2099-01-01T00:00:00.000Z',
      photos: [
        {
          photoId: 'photo-1',
          url: 'https://example.test/old.jpg',
          matchedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const refreshed: GalleryResponse = {
      ...initial,
      eventName: 'Refreshed event',
      photos: [
        {
          photoId: 'photo-1',
          url: 'https://example.test/new.jpg',
          matchedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    vi.spyOn(galleryApi, 'getGallery').mockResolvedValue(initial);
    const refresh = vi
      .spyOn(galleryApi, 'refreshGallery')
      .mockResolvedValue(refreshed);
    render(<GalleryPage token="refresh-token" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(refresh).toHaveBeenCalledWith('refresh-token');
    expect(
      screen.getByRole('heading', { name: 'Refreshed event.' }),
    ).toBeInTheDocument();
  });
});
