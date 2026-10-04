import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/web/executionMode', () => ({ executionMode: 'aws' }));
vi.mock('../../src/web/realApi', () => ({
  getEvent: vi.fn(),
  getEvents: vi.fn(),
  createRegistration: vi.fn(),
  uploadFileToS3: vi.fn(),
  getRegistrationStatus: vi.fn(),
  reportEnrollmentError: vi.fn(),
}));
import * as real from '../../src/web/realApi';
import {
  createRegistration,
  uploadFileToS3,
  getRegistrationStatus,
  getEnrollmentErrorCounts,
} from '../../src/web/api';
describe('enrollment error counts', () => {
  it('counts failures by stage, preserves errors and exposes no request data', async () => {
    const failure = new Error('stable-code');
    vi.mocked(real.createRegistration).mockRejectedValue(failure);
    vi.mocked(real.uploadFileToS3).mockRejectedValue(failure);
    vi.mocked(real.getRegistrationStatus).mockRejectedValue(failure);
    await expect(
      createRegistration('event', {
        consentBiometrics: true,
        consentTerms: true,
      }),
    ).rejects.toBe(failure);
    await expect(
      uploadFileToS3(
        'synthetic-secret-url',
        new File(['x'], 'synthetic.jpg'),
        vi.fn(),
      ),
    ).rejects.toBe(failure);
    await expect(
      getRegistrationStatus('synthetic-id', 'synthetic-token'),
    ).rejects.toBe(failure);
    expect(getEnrollmentErrorCounts()).toEqual({
      registration: 1,
      upload: 1,
      polling: 1,
    });
    // Only the stage and the thrown error reach the reporter: never the URL,
    // registration ID, token or request payload of the failed call.
    expect(vi.mocked(real.reportEnrollmentError).mock.calls).toEqual([
      ['registration', failure],
      ['upload', failure],
      ['polling', failure],
    ]);
    const snapshot = getEnrollmentErrorCounts();
    expect(Object.keys(snapshot)).toEqual([
      'registration',
      'upload',
      'polling',
    ]);
    expect(getEnrollmentErrorCounts()).not.toBe(snapshot);
    vi.mocked(real.getRegistrationStatus).mockResolvedValue({
      registrationId: 'synthetic-id',
      status: 'ENROLLED',
    });
    await getRegistrationStatus('synthetic-id', 'synthetic-token');
    expect(getEnrollmentErrorCounts().polling).toBe(1);
    expect(real.reportEnrollmentError).toHaveBeenCalledTimes(3);
  });
});
