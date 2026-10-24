import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import { createCognitoGateway } from '../../src/web/cognitoGateway';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});
function openRecovery(
  completePasswordRecovery = vi.fn().mockResolvedValue(undefined),
) {
  window.history.pushState({}, '', '/admin/login');
  render(<App authGateway={{ login: vi.fn(), completePasswordRecovery }} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ya tengo un código de recuperación' }),
  );
  return completePasswordRecovery;
}
function submit(password = 'Permanent1!test', confirmation = password) {
  fireEvent.change(screen.getByLabelText('Usuario'), {
    target: { value: 'synthetic' },
  });
  fireEvent.change(screen.getByLabelText('Código de recuperación'), {
    target: { value: '123456' },
  });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Repite la contraseña'), {
    target: { value: confirmation },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Guardar nueva contraseña' }),
  );
}
describe('password reset completion', () => {
  it('completes the reset without authenticating or persisting codes and passwords', async () => {
    const complete = openRecovery();
    submit();
    await screen.findByRole('status');
    expect(complete).toHaveBeenCalledWith(
      'synthetic',
      '123456',
      'Permanent1!test',
    );
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    expect(window.location.pathname).toBe('/admin/login');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver al inicio de sesión' }),
    );
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });
  it('clears sensitive fields after an expired or incorrect code without exposing server details', async () => {
    openRecovery(vi.fn().mockRejectedValue(new Error('private AWS detail')));
    submit();
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(screen.getByLabelText('Nueva contraseña')).toHaveValue(''),
    );
    expect(screen.getByLabelText('Código de recuperación')).toHaveValue('');
    expect(screen.getByLabelText('Repite la contraseña')).toHaveValue('');
    expect(screen.queryByText('private AWS detail')).toBeNull();
  });
  it.each([
    ['weak', 'weak'],
    ['Permanent1!test', 'Other1!password'],
  ])('rejects invalid password input', (password, confirmation) => {
    const complete = openRecovery();
    submit(password, confirmation);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not show success in a new form when a cancelled request finishes later', async () => {
    let finish = () => {};
    openRecovery(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    submit();
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver al inicio de sesión' }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Ya tengo un código de recuperación',
      }),
    );
    finish();
    await waitFor(() =>
      expect(screen.getByLabelText('Código de recuperación')).toHaveValue(''),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('uses ConfirmForgotPassword with the configured public client and does not return a session', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    const gateway = createCognitoGateway({
      userPoolId: 'eu-west-1_test',
      clientId: 'public-client',
      region: 'eu-west-1',
    });
    await expect(
      gateway.completePasswordRecovery?.(
        ' synthetic ',
        ' 123456 ',
        'Permanent1!test',
      ),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-amz-target': 'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ClientId: 'public-client',
      Username: 'synthetic',
      ConfirmationCode: '123456',
      Password: 'Permanent1!test',
    });
  });
  it('fails safely on missing configuration and rejected codes', async () => {
    await expect(
      createCognitoGateway(null).completePasswordRecovery?.(
        'synthetic',
        '123456',
        'Permanent1!test',
      ),
    ).rejects.toThrow('COGNITO_NOT_CONFIGURED');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"private"}', { status: 400 }),
    );
    await expect(
      createCognitoGateway({
        userPoolId: 'eu-west-1_test',
        clientId: 'public-client',
        region: 'eu-west-1',
      }).completePasswordRecovery?.('synthetic', '123456', 'Permanent1!test'),
    ).rejects.toThrow('RECOVERY_REJECTED');
  });
});
