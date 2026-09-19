import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  pollRegistrationStatus,
} from '../../src/web/pollRegistrationStatus';
import type { RegistrationStatusResponse } from '../../src/web/types';

const status = (
  value: RegistrationStatusResponse['status'],
): RegistrationStatusResponse => ({ registrationId: 'reg-1', status: value });

afterEach(() => vi.useRealTimers());

async function run(getStatus: () => Promise<RegistrationStatusResponse>) {
  vi.useFakeTimers();
  const onUpdate = vi.fn();
  const promise = pollRegistrationStatus(getStatus, onUpdate);
  const settled = promise.then(
    () => 'ok',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(POLL_ATTEMPTS * POLL_INTERVAL_MS);
  return { result: await settled, onUpdate };
}

describe('pollRegistrationStatus', () => {
  it('stops at ENROLLED', async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(status('PROCESSING'))
      .mockResolvedValueOnce(status('ENROLLED'));
    const { onUpdate } = await run(getStatus);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith(status('ENROLLED'));
  });

  it('stops at FAILED', async () => {
    const getStatus = vi.fn().mockResolvedValue(status('FAILED'));
    await run(getStatus);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('gives up after 10 attempts while still processing', async () => {
    const getStatus = vi.fn().mockResolvedValue(status('PROCESSING'));
    await run(getStatus);
    expect(getStatus).toHaveBeenCalledTimes(10);
  });

  it('retries recoverable errors such as an unknown status', async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('UNKNOWN_STATUS'))
      .mockResolvedValueOnce(status('ENROLLED'));
    const { result } = await run(getStatus);
    expect(result).toBe('ok');
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('rethrows when every attempt fails', async () => {
    const getStatus = vi.fn().mockRejectedValue(new Error('NETWORK_ERROR'));
    const { result } = await run(getStatus);
    expect(result).toBeInstanceOf(Error);
    expect(getStatus).toHaveBeenCalledTimes(10);
  });
});
