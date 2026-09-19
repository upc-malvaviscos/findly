import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistration,
  getEvent,
  getRegistrationStatus,
} from '../../src/web/realApi';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('real API adapter', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails with an actionable code when the backend is not configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    await expect(getEvent('demo-2026')).rejects.toThrow(
      'BACKEND_NOT_CONFIGURED',
    );
  });

  it('gets an event and maps a 404 to null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          eventId: 'demo-2026',
          name: 'Demo',
          date: '2026-09-18',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { code: 'EVENT_NOT_FOUND', message: 'x', requestId: 'r' },
          404,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getEvent('demo-2026')).resolves.toMatchObject({
      eventId: 'demo-2026',
      name: 'Demo',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/events/demo-2026',
    );
    await expect(getEvent('missing')).resolves.toBeNull();
  });

  it('posts the registration with consent set to true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        registrationId: 'reg-1',
        uploadUrl: 'https://s3.example.com/put',
        expiresInSeconds: 300,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createRegistration('demo-2026', {
        email: 'ada@example.com',
        consentBiometrics: true,
        consentTerms: true,
      }),
    ).resolves.toMatchObject({ registrationId: 'reg-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/events/demo-2026/registrations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      consentBiometrics: true,
      consentTerms: true,
    });
  });

  it('surfaces the backend error code without leaking the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { code: 'CONSENT_REQUIRED', message: 'secret', requestId: 'r' },
            400,
          ),
        ),
    );
    await expect(
      createRegistration('demo-2026', {
        consentBiometrics: true,
        consentTerms: true,
      }),
    ).rejects.toThrow('CONSENT_REQUIRED');
  });

  it('maps network failures and non-JSON bodies to stable codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('boom')));
    await expect(getRegistrationStatus('reg-1')).rejects.toThrow(
      'NETWORK_ERROR',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })),
    );
    await expect(getRegistrationStatus('reg-1')).rejects.toThrow(
      'INVALID_RESPONSE',
    );
  });

  it('rejects unknown registration statuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ registrationId: 'reg-1', status: 'WAT' }),
        ),
    );
    await expect(getRegistrationStatus('reg-1')).rejects.toThrow(
      'UNKNOWN_STATUS',
    );
  });
});
