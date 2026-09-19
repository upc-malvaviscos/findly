import type { RegistrationStatusResponse } from './types';

export const POLL_ATTEMPTS = 10;
export const POLL_INTERVAL_MS = 1500;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Polls until the registration reaches ENROLLED or FAILED, or the attempt
 * budget runs out. Individual failures (network, unknown status, non-JSON) are
 * recoverable and retried; the last one is rethrown only if no poll succeeded.
 */
export async function pollRegistrationStatus(
  getStatus: () => Promise<RegistrationStatusResponse>,
  onUpdate: (result: RegistrationStatusResponse) => void,
): Promise<void> {
  let lastError: unknown;
  let succeeded = false;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    try {
      const result = await getStatus();
      succeeded = true;
      onUpdate(result);
      if (result.status === 'ENROLLED' || result.status === 'FAILED') return;
    } catch (error) {
      lastError = error;
    }
    if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
  }
  if (!succeeded) throw lastError;
}
