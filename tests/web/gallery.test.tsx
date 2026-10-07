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
  it('shows matches that arrive after the gallery was initially empty', async () => {
    vi.useFakeTimers();
    const initial: GalleryResponse = {
      eventId: 'event-synthetic',
      eventName: 'Synthetic event',
      registrationId: 'registration-synthetic',
      expiresAt: '2099-01-01T00:00:00.000Z',
      photos: [],
    };
    vi.spyOn(galleryApi, 'getGallery').mockResolvedValue(initial);
    vi.spyOn(galleryApi, 'refreshGallery').mockResolvedValue({
      ...initial,
      photos: [
        {
          photoId: 'photo-synthetic',
          url: 'https://example.test/synthetic.jpg',
          downloadUrl: 'https://example.test/synthetic-download.jpg',
          matchedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    render(<GalleryPage token="synthetic-refresh-token" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Aún no hay fotos.' }),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(
      screen.getByRole('img', { name: 'Fotografía del evento' }),
    ).toHaveAttribute('src', 'https://example.test/synthetic.jpg');
    expect(
      screen.queryByRole('heading', { name: 'Aún no hay fotos.' }),
    ).not.toBeInTheDocument();
  });

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

  it('does not leave the erased state when a pending refresh returns photos', async () => {
    vi.useFakeTimers();
    const initial: GalleryResponse = {
      eventId: 'event-synthetic',
      eventName: 'Synthetic event',
      registrationId: 'registration-synthetic',
      expiresAt: '2099-01-01T00:00:00.000Z',
      photos: [],
    };
    vi.spyOn(galleryApi, 'getGallery').mockResolvedValue(initial);
    let finishRefresh: (response: GalleryResponse) => void = () => {
      throw new Error('Refresh has not started');
    };
    vi.spyOn(galleryApi, 'refreshGallery').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    vi.spyOn(galleryApi, 'deleteRegistration').mockResolvedValue();
    render(<GalleryPage token="synthetic-refresh-token" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mis datos' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmar borrado' }),
      );
    });
    await act(async () => {
      finishRefresh({
        ...initial,
        photos: [
          {
            photoId: 'photo-synthetic',
            url: 'https://example.test/synthetic.jpg',
            downloadUrl: 'https://example.test/synthetic-download.jpg',
            matchedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });
    expect(
      screen.getByRole('heading', { name: 'Tus datos han sido eliminados.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
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

  it('downloads through the authorized attachment URL, not the inline viewing URL', async () => {
    render(<GalleryPage token="demo-gallery" />);
    await screen.findByRole('heading', { name: /Findly Demo Night/ });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Abrir fotografía' })[0]!,
    );
    const inlineImage = screen.getByRole('img', {
      name: 'Fotografía ampliada del evento',
    });
    const download = screen.getByRole('link', { name: 'Descargar' });
    expect(download).toHaveAttribute('download');
    expect(download).toHaveAttribute(
      'href',
      expect.stringContaining('dl=findly-photo-1.jpg'),
    );
    expect(download.getAttribute('href')).not.toBe(
      inlineImage.getAttribute('src'),
    );
  });

  it('refreshes manually on demand without waiting for the periodic timer', async () => {
    const initial: GalleryResponse = {
      eventId: 'event-synthetic',
      eventName: 'Synthetic event',
      registrationId: 'registration-synthetic',
      expiresAt: '2099-01-01T00:00:00.000Z',
      photos: [],
    };
    vi.spyOn(galleryApi, 'getGallery').mockResolvedValue(initial);
    const refresh = vi.spyOn(galleryApi, 'refreshGallery').mockResolvedValue({
      ...initial,
      photos: [
        {
          photoId: 'photo-synthetic',
          url: 'https://example.test/synthetic.jpg',
          downloadUrl: 'https://example.test/synthetic-download.jpg',
          matchedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    render(<GalleryPage token="synthetic-refresh-token" />);
    await screen.findByRole('heading', { name: 'Aún no hay fotos.' });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar fotos' }));
    expect(refresh).toHaveBeenCalledWith('synthetic-refresh-token');
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Fotografía del evento' }),
      ).toBeInTheDocument(),
    );
  });

  it('shows a recoverable error when a manual refresh fails on the network', async () => {
    render(<GalleryPage token="demo-gallery" />);
    await screen.findByRole('heading', { name: /Findly Demo Night/ });
    vi.spyOn(galleryApi, 'refreshGallery').mockRejectedValue(
      new Error('GALLERY_NETWORK_ERROR'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar fotos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No hemos podido actualizar tus fotos.',
    );
    expect(
      screen.getByRole('heading', { name: /Findly Demo Night/ }),
    ).toBeInTheDocument();
  });

  it('stops the periodic refresh and shows the expired state when a refresh finds the link expired', async () => {
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
          downloadUrl: 'https://example.test/old-download.jpg',
          matchedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    vi.spyOn(galleryApi, 'getGallery').mockResolvedValue(initial);
    vi.spyOn(galleryApi, 'refreshGallery').mockRejectedValue(
      new Error('GALLERY_EXPIRED'),
    );
    render(<GalleryPage token="expiring-token" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(
      screen.getByRole('heading', { name: 'Enlace caducado.' }),
    ).toBeInTheDocument();
  });

  it('copies the shareable gallery link with a deletion-capability warning', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<GalleryPage token="demo-gallery" />);
    await screen.findByRole('heading', { name: /Findly Demo Night/ });
    expect(screen.getByText(/también eliminar tus datos/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copiar enlace de la galería' }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/gallery?token=demo-gallery'),
    );
    expect(await screen.findByText('Enlace copiado.')).toBeInTheDocument();
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
          downloadUrl: 'https://example.test/old-download.jpg',
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
          downloadUrl: 'https://example.test/new-download.jpg',
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
