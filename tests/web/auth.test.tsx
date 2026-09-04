import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('frontend authentication', () => {
  it('redirects unauthenticated organizers to login', () => {
    window.history.pushState({}, '', '/admin/events');
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
  });

  it('allows a valid organizer to enter and logout', async () => {
    window.history.pushState({}, '', '/admin/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: 'organizer' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Tus eventos' }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
  });
});
