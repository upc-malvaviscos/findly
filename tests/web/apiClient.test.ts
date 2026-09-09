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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/events');
    const headers = new Headers(requestInit.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-token');
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
