import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, AuthenticationError } from '../../src/web/apiClient';

afterEach(() => vi.restoreAllMocks());

describe('apiClient', () => {
  it('adds bearer authorization to administrative requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    await apiClient<{ ok: boolean }>('/admin/events', { token: 'jwt-token' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/events',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }),
      }),
    );
  });

  it('turns unauthorized responses into a session error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 401 }),
    );
    await expect(
      apiClient('/admin/events', { token: 'expired' }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
