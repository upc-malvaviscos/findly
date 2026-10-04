import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENROLLMENT_ERROR_REPORTS,
  createRegistration,
  getEvent,
  getRegistrationStatus,
  reportEnrollmentError,
  resetEnrollmentErrorReports,
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
        galleryToken: 'synthetic-token',
        uploadUrl: 'https://s3.example.com/put',
        expiresInSeconds: 300,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createRegistration('demo-2026', {
        email: 'synthetic@example.com',
        consentBiometrics: true,
        consentTerms: true,
      }),
    ).resolves.toMatchObject({ registrationId: 'reg-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/events/demo-2026/registrations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: 'synthetic@example.com',
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
        email: 'synthetic@example.com',
        consentBiometrics: true,
        consentTerms: true,
      }),
    ).rejects.toThrow('CONSENT_REQUIRED');
  });

  it('maps network failures and non-JSON bodies to stable codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('boom')));
    await expect(
      getRegistrationStatus('reg-1', 'synthetic-token'),
    ).rejects.toThrow('NETWORK_ERROR');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })),
    );
    await expect(
      getRegistrationStatus('reg-1', 'synthetic-token'),
    ).rejects.toThrow('INVALID_RESPONSE');
  });

  it('sends the gallery capability in a header when polling', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ registrationId: 'reg-1', status: 'ENROLLED' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await getRegistrationStatus('reg-1', 'synthetic-token');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/registrations/reg-1/status',
    );
    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers,
    );
    expect(headers.get('X-Gallery-Token')).toBe('synthetic-token');
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
    await expect(
      getRegistrationStatus('reg-1', 'synthetic-token'),
    ).rejects.toThrow('UNKNOWN_STATUS');
  });
});

describe('client enrollment error reports (ADR-018)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/');
    resetEnrollmentErrorReports();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts only the stage and a closed code to the telemetry route', () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    reportEnrollmentError('upload', new Error('UPLOAD_FAILED_403'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/telemetry/enrollment-errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(JSON.parse(init.body as string)).toEqual({
      stage: 'upload',
      code: 'UPLOAD_HTTP_4XX',
    });
  });

  it('never sends free-text error messages', () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    reportEnrollmentError('registration', new Error('user@example.com failed'));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ stage: 'registration', code: 'UNKNOWN' }),
    );
  });

  it('caps reports per session and never throws when telemetry fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    for (let index = 0; index < MAX_ENROLLMENT_ERROR_REPORTS + 5; index += 1)
      expect(() =>
        reportEnrollmentError('polling', new Error('NETWORK_ERROR')),
      ).not.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENROLLMENT_ERROR_REPORTS);
  });

  it('does nothing without a configured backend', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    reportEnrollmentError('upload', new Error('UPLOAD_FAILED'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
