import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GalleryPage } from '../../src/web/components/gallery/GalleryPage';

afterEach(cleanup);

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
});
