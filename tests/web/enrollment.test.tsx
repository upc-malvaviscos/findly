import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelfieCaptureForm } from '../../src/web/components/SelfieCaptureForm';
import { resetMockState } from '../../src/web/fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetMockState();
});

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Nombre completo'), {
    target: { value: 'Ada Lovelace' },
  });
  fireEvent.change(screen.getByLabelText('Email para tu galería'), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error('File input not found');
  fireEvent.change(input, {
    target: {
      files: [new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' })],
    },
  });
}

describe('SelfieCaptureForm', () => {
  it('shows inline validation before submitting', () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));

    expect(screen.getByText('Escribe tu nombre completo.')).toBeInTheDocument();
    expect(screen.getByText('Introduce un email válido.')).toBeInTheDocument();
    expect(
      screen.getByText('Necesitamos tu consentimiento para tratar la imagen.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Selecciona una imagen.')).toBeInTheDocument();
  });

  it('previews a selected image and replaces it predictably', () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error('File input not found');
    const first = new File(['one'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['two'], 'second.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [first] } });
    expect(
      screen.getByAltText('Vista previa de tu selfie'),
    ).toBeInTheDocument();
    expect(screen.getByText('Imagen seleccionada')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [second] } });
    expect(screen.getByText('Imagen seleccionada')).toBeInTheDocument();
  });

  it('falls back with an announced message when camera access is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<SelfieCaptureForm eventId="demo-2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'Usar cámara' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No hemos podido acceder a la cámara',
    );
  });

  it('completes the mocked upload and stops on enrolled', async () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    fillValidForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));
    await waitFor(
      () => expect(screen.getByText('Registro completado')).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByText(/Te enviaremos el enlace/)).toBeInTheDocument();
  });
});
