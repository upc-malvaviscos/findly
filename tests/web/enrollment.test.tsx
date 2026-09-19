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
import { createRegistration } from '../../src/web/api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetMockState();
});

function acceptConsent() {
  fireEvent.click(screen.getByLabelText(/tratamiento biométrico/));
  fireEvent.click(screen.getByLabelText(/términos de privacidad/));
}

function attachSelfie() {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error('File input not found');
  fireEvent.change(input, {
    target: {
      files: [new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' })],
    },
  });
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Email para tu galería/), {
    target: { value: 'ada@example.com' },
  });
  acceptConsent();
  attachSelfie();
}

vi.mock('../../src/web/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/web/api')>();
  return {
    ...original,
    createRegistration: vi.fn(original.createRegistration),
  };
});

describe('SelfieCaptureForm', () => {
  it('shows inline validation before submitting', () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));

    expect(
      screen.getByText('Necesitamos tu consentimiento para tratar tu imagen.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Acepta los términos de privacidad para continuar.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Selecciona una imagen.')).toBeInTheDocument();
  });

  it('sends nothing before consent and sends consent as true afterwards', async () => {
    const create = vi.mocked(createRegistration);
    create.mockClear();
    render(<SelfieCaptureForm eventId="demo-2026" />);
    attachSelfie();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));
    expect(create).not.toHaveBeenCalled();

    acceptConsent();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      consentBiometrics: true,
      consentTerms: true,
    });
  });

  it('validates email format only when one is provided', () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    fireEvent.change(screen.getByLabelText(/Email para tu galería/), {
      target: { value: 'not-an-email' },
    });
    acceptConsent();
    attachSelfie();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));

    expect(screen.getByText('Introduce un email válido.')).toBeInTheDocument();
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

  it('completes the mocked upload without an email, since it is optional', async () => {
    render(<SelfieCaptureForm eventId="demo-2026" />);
    acceptConsent();
    attachSelfie();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar mi selfie' }));
    await waitFor(
      () => expect(screen.getByText('Registro completado')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});
