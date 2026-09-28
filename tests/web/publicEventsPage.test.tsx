import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/web/api', () => ({ getEvents: vi.fn(), getEvent: vi.fn() }));
vi.mock('../../src/web/components/SelfieCaptureForm', () => ({
  SelfieCaptureForm: ({ eventId }: { eventId: string }) => (
    <div>Inscripción {eventId}</div>
  ),
}));
import { getEvent, getEvents } from '../../src/web/api';
import { App } from '../../src/web/App';
const event = (eventId: string) => ({
  eventId,
  name: `Evento ${eventId}`,
  date: '2026-10-01T12:00:00Z',
  location: '',
  description: '',
});
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});
afterEach(cleanup);
describe('public event selection', () => {
  it('discovers backend events and changes the registration event', async () => {
    vi.mocked(getEvents).mockResolvedValue([event('one'), event('two')]);
    render(<App />);
    await screen.findByText('Inscripción one');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'two' },
    });
    expect(screen.getByText('Inscripción two')).toBeInTheDocument();
    expect(screen.queryByText('Findly Demo Night')).not.toBeInTheDocument();
  });
  it('validates explicit event links and never falls back to a fixture', async () => {
    window.history.replaceState({}, '', '/?event=missing');
    vi.mocked(getEvent).mockResolvedValue(null);
    render(<App />);
    await screen.findByText('No hay eventos disponibles para inscribirse.');
    expect(getEvents).not.toHaveBeenCalled();
  });
  it('shows an actionable load error when backend config or request fails', async () => {
    vi.mocked(getEvents).mockRejectedValue(new Error('BACKEND_NOT_CONFIGURED'));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No hemos podido cargar los eventos',
      ),
    );
    expect(screen.queryByText('Inscripción demo-2026')).not.toBeInTheDocument();
  });
});
