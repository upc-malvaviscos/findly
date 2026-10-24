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
import { AdminEvents } from '../../src/web/components/admin/AdminEvents';
import { EventPhotoManager } from '../../src/web/components/admin/EventPhotoManager';
import { AuthContext } from '../../src/web/context/auth';
import type { AuthContextValue } from '../../src/web/context/auth';
import * as adminApi from '../../src/web/adminApi';
import type { AdminEvent } from '../../src/shared/types/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fakeAuth: AuthContextValue = {
  session: {
    idToken: 'token-1',
    expiresAt: Date.now() + 60000,
    username: 'organizer',
  },
  isAuthenticated: true,
  login: vi.fn(),
  newPasswordChallenge: null,
  challengeExpired: false,
  completePasswordRecovery: vi.fn(),
  completeNewPassword: vi.fn(),
  cancelNewPassword: vi.fn(),
  logout: vi.fn(),
};

function renderWithAuth(ui: React.ReactElement) {
  return render(
    <AuthContext.Provider value={fakeAuth}>{ui}</AuthContext.Provider>,
  );
}

const demoEvent: AdminEvent = {
  eventId: 'evt-1',
  name: 'Demo Night',
  date: '2026-10-01T10:00:00.000Z',
  retentionDays: 30,
  createdAt: '2026-09-01T00:00:00.000Z',
  status: 'OPEN',
};

describe('AdminEvents edit form', () => {
  it('keeps edit-form labels from colliding with the create form under Playwright getByLabel matching', async () => {
    // Testing Library's getByLabelText defaults to an exact match, which
    // would not have caught this: Playwright's getByLabel (used by
    // e2e/local-admin.spec.ts) defaults to a case-insensitive *substring*
    // match, so "Nombre del evento (editar)" still collided with "Nombre
    // del evento". Replicate that matching rule directly instead.
    vi.spyOn(adminApi, 'getAdminEvents').mockResolvedValue({
      events: [demoEvent],
    });
    renderWithAuth(<AdminEvents onLogout={() => {}} />);
    await screen.findByDisplayValue('Demo Night');
    const createLabels = ['Nombre del evento', 'Fecha', 'Retención (días)'];
    const allLabels = Array.from(
      document.querySelectorAll('label.field > span'),
    ).map((node) => node.textContent ?? '');
    for (const created of createLabels) {
      const matches = allLabels.filter((label) =>
        label.toLowerCase().includes(created.toLowerCase()),
      );
      expect(matches).toEqual([created]);
    }
  });

  it('pre-fills the edit form from the selected event and saves an update', async () => {
    vi.spyOn(adminApi, 'getAdminEvents').mockResolvedValue({
      events: [demoEvent],
    });
    const updateSpy = vi
      .spyOn(adminApi, 'updateAdminEvent')
      .mockResolvedValue({ ...demoEvent, name: 'Renamed Night' });

    renderWithAuth(<AdminEvents onLogout={() => {}} />);

    const nameInput = await screen.findByDisplayValue('Demo Night');
    fireEvent.change(nameInput, { target: { value: 'Renamed Night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        'token-1',
        'evt-1',
        expect.objectContaining({ name: 'Renamed Night' }),
      ),
    );
  });

  it('requires a second confirmation before deleting an event', async () => {
    vi.spyOn(adminApi, 'getAdminEvents').mockResolvedValue({
      events: [demoEvent],
    });
    const deleteSpy = vi
      .spyOn(adminApi, 'deleteAdminEvent')
      .mockResolvedValue(undefined);

    renderWithAuth(<AdminEvents onLogout={() => {}} />);
    await screen.findByDisplayValue('Demo Night');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar evento' }));
    expect(deleteSpy).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar eliminación' }),
    );
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith('token-1', 'evt-1'),
    );
  });
});

describe('EventPhotoManager', () => {
  it('lists photos, loads more on demand and deletes one after confirmation', async () => {
    vi.spyOn(adminApi, 'getEventPhotos').mockResolvedValueOnce({
      photos: [{ photoId: 'photo-1', uploadedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: 'cursor-1',
    });
    const deleteSpy = vi
      .spyOn(adminApi, 'deleteEventPhoto')
      .mockResolvedValue(undefined);

    render(<EventPhotoManager eventId="evt-1" token="token-1" />);
    await screen.findByText('photo-1');

    vi.spyOn(adminApi, 'getEventPhotos').mockResolvedValueOnce({
      photos: [{ photoId: 'photo-2', uploadedAt: '2026-01-02T00:00:00.000Z' }],
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Cargar más fotografías' }),
    );
    await screen.findByText('photo-2');

    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith('token-1', 'evt-1', 'photo-1'),
    );
    await waitFor(() => expect(screen.queryByText('photo-1')).toBeNull());
  });

  it('shows an error and keeps the photo when deletion fails', async () => {
    vi.spyOn(adminApi, 'getEventPhotos').mockResolvedValue({
      photos: [{ photoId: 'photo-1', uploadedAt: '2026-01-01T00:00:00.000Z' }],
    });
    vi.spyOn(adminApi, 'deleteEventPhoto').mockRejectedValue(new Error('x'));

    render(<EventPhotoManager eventId="evt-1" token="token-1" />);
    await screen.findByText('photo-1');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    });

    await screen.findByRole('alert');
    expect(screen.getByText('photo-1')).toBeInTheDocument();
  });
});
