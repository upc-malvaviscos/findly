import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
