import React from 'react';
import { act } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import type { AuthGateway } from '../../src/web/context/AuthProvider';

const gateway: AuthGateway = {
  async login(username) {
    return {
      username,
      idToken: 'test-id-token',
      expiresAt: Date.now() + 60_000,
    };
  },
};

function invitationGateway(
  complete: NonNullable<AuthGateway['completeNewPassword']>,
  validity = 60_000,
): AuthGateway {
  return {
    login: async () => ({
      kind: 'new-password-required',
      username: 'invited',
      session: 'synthetic-challenge',
      expiresAt: Date.now() + validity,
    }),
    completeNewPassword: complete,
  };
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText('Usuario'), {
    target: { value: 'invited' },
  });
  fireEvent.change(screen.getByLabelText('Contraseña'), {
    target: { value: 'temporary' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

function submitNewPassword(
  password = 'Permanent1!test',
  confirmation = password,
) {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Repite la contraseña'), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('frontend authentication', () => {
  it('validates new passwords without sending mismatches or weak passwords to Cognito', async () => {
    const complete = vi.fn();
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invitationGateway(complete)} />);
    submitLogin();
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    submitNewPassword('Permanent1!test', 'Other1!password');
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden');
    submitNewPassword('short');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'cumplir los requisitos',
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it('clears invitation fields when the user cancels', async () => {
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invitationGateway(vi.fn())} />);
    submitLogin();
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'Permanent1!test' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver al inicio de sesión' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
  });
  it('returns an expired challenge to login without preserving the password', async () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invitationGateway(complete, 1000)} />);
    await act(async () => {
      submitLogin();
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Elige tu contraseña.' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'Permanent1!test' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La sesión ha caducado',
    );
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    expect(complete).not.toHaveBeenCalled();
  });
  it('keeps a fresh challenge when a cancelled old request reports expiry', async () => {
    let rejectOld: (error: Error) => void = () => {
      throw new Error('Request not started');
    };
    const complete = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          rejectOld = reject;
        }),
    );
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invitationGateway(complete)} />);
    submitLogin();
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    submitNewPassword();
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver al inicio de sesión' }),
    );
    submitLogin();
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    await act(async () => {
      rejectOld(new Error('AUTH_CHALLENGE_EXPIRED'));
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Elige tu contraseña.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/La sesión ha caducado/)).not.toBeInTheDocument();
  });
  it('does not authenticate a cancelled password completion that finishes later', async () => {
    let finish: (session: {
      username: string;
      idToken: string;
      expiresAt: number;
    }) => void = () => {
      throw new Error('Request not started');
    };
    const complete = vi.fn(
      () =>
        new Promise<{ username: string; idToken: string; expiresAt: number }>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invitationGateway(complete)} />);
    submitLogin();
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    submitNewPassword();
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver al inicio de sesión' }),
    );
    await act(async () => {
      finish({
        username: 'invited',
        idToken: 'synthetic-token',
        expiresAt: Date.now() + 60_000,
      });
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/login');
  });
  it('lets an invited organizer choose a permanent password before accessing events', async () => {
    const complete = vi.fn().mockResolvedValue({
      username: 'invited',
      idToken: 'test-id-token',
      expiresAt: Date.now() + 60_000,
    });
    const invited: AuthGateway = {
      login: async () => ({
        kind: 'new-password-required',
        username: 'invited',
        session: 'synthetic-challenge',
        expiresAt: Date.now() + 60_000,
      }),
      completeNewPassword: complete,
    };
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={invited} />);
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: 'invited' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'temporary' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: 'Elige tu contraseña.' });
    expect(window.location.pathname).toBe('/admin/login');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'Permanent1!test' },
    });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), {
      target: { value: 'Permanent1!test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    await screen.findByRole('heading', { name: 'Tus eventos' });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ session: 'synthetic-challenge' }),
      'Permanent1!test',
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('redirects unauthenticated organizers to login', () => {
    window.history.pushState({}, '', '/admin/events');
    render(<App authGateway={gateway} />);
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
  });

  it('redirects /admin to the organizer login route', async () => {
    window.history.pushState({}, '', '/admin');
    render(<App authGateway={gateway} />);
    await waitFor(() => expect(window.location.pathname).toBe('/admin/login'));
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
  });

  it('allows a valid organizer to enter and logout', async () => {
    window.history.pushState({}, '', '/admin/login');
    render(<App authGateway={gateway} />);
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

  it('returns an expired organizer session to login without a blank screen', async () => {
    vi.useFakeTimers();
    const expiringGateway: AuthGateway = {
      async login(username) {
        return {
          username,
          idToken: 'expiring-id-token',
          expiresAt: Date.now() + 1_000,
        };
      },
    };
    window.history.pushState({}, '', '/admin/events');
    render(<App authGateway={expiringGateway} />);
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: 'organizer' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'password' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Tus eventos' }),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByRole('heading', { name: 'Iniciar sesión.' }),
    ).toBeInTheDocument();
  });
});
