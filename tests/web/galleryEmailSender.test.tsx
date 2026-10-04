import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GalleryEmailSender } from '../../src/web/components/admin/GalleryEmailSender';
import {
  getGalleryEmailStatus,
  requestGalleryEmail,
} from '../../src/web/adminApi';
import type { GalleryEmailOperation } from '../../src/shared/types/api';
vi.mock('../../src/web/adminApi', () => ({
  requestGalleryEmail: vi.fn(),
  getGalleryEmailStatus: vi.fn(),
}));
const completed: GalleryEmailOperation = {
  operationId: '00000000-0000-4000-8000-000000000001',
  status: 'COMPLETED',
  accepted: 2,
  skipped: 1,
  missingEmail: 1,
  failed: 1,
  uncertain: 1,
  bounced: 1,
  complained: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requestGalleryEmail).mockResolvedValue(completed);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Enviar galerías' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
}
it('requires confirmation, allows cancelling and displays provider acceptance separately from delivery', async () => {
  render(<GalleryEmailSender eventId="synthetic" token="synthetic-token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar galerías' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(requestGalleryEmail).not.toHaveBeenCalled();
  confirm();
  expect(await screen.findByText('Envío finalizado')).toBeInTheDocument();
  expect(screen.getByText(/Aceptados por SES: 2/)).toHaveTextContent(
    'Resultado incierto: 1',
  );
  expect(screen.getByText(/no confirma la entrega/)).toBeInTheDocument();
});
it('uses a distinct operation UUID for each intentional confirmation', async () => {
  render(<GalleryEmailSender eventId="synthetic" token="synthetic-token" />);
  confirm();
  await screen.findByText('Envío finalizado');
  confirm();
  await waitFor(() => expect(requestGalleryEmail).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(requestGalleryEmail).mock.calls;
  expect(first?.[0]).toBe('synthetic-token');
  expect(first?.[1]).toBe('synthetic');
  expect(first?.[2]).not.toBe(second?.[2]);
});
it('prevents double clicks and preserves the same UUID after an uncertain request response', async () => {
  let rejectRequest: (error: Error) => void = () => {};
  vi.mocked(requestGalleryEmail).mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectRequest = reject;
    }),
  );
  render(<GalleryEmailSender eventId="synthetic" token="synthetic-token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar galerías' }));
  const button = screen.getByRole('button', { name: 'Confirmar envío' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(requestGalleryEmail).toHaveBeenCalledTimes(1);
  await act(async () => {
    rejectRequest(new Error('synthetic'));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar solicitud' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
  await screen.findByText('Envío finalizado');
  const calls = vi.mocked(requestGalleryEmail).mock.calls;
  expect(calls[0]?.[2]).toBe(calls[1]?.[2]);
});
it('polls through a transient status failure and stops after completion', async () => {
  vi.useFakeTimers();
  vi.mocked(requestGalleryEmail).mockResolvedValue({
    ...completed,
    status: 'RUNNING',
  });
  vi.mocked(getGalleryEmailStatus)
    .mockRejectedValueOnce(new Error('synthetic'))
    .mockResolvedValueOnce({ ...completed, status: 'RUNNING' })
    .mockResolvedValue(completed);
  render(<GalleryEmailSender eventId="synthetic" token="synthetic-token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar galerías' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
  });
  expect(
    screen.getByRole('button', { name: 'Enviar galerías' }),
  ).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Seguimos comprobándolo');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(screen.getByText('Envío finalizado')).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(getGalleryEmailStatus).toHaveBeenCalledTimes(3);
});
it('discards a late status response after unmounting', async () => {
  vi.useFakeTimers();
  vi.mocked(requestGalleryEmail).mockResolvedValue({
    ...completed,
    status: 'RUNNING',
  });
  let resolveStatus: (value: GalleryEmailOperation) => void = () => {};
  vi.mocked(getGalleryEmailStatus).mockReturnValue(
    new Promise((resolve) => {
      resolveStatus = resolve;
    }),
  );
  const { unmount } = render(
    <GalleryEmailSender eventId="synthetic" token="synthetic-token" />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enviar galerías' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  unmount();
  await act(async () => {
    resolveStatus(completed);
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(getGalleryEmailStatus).toHaveBeenCalledTimes(1);
});
