import { executionMode } from './executionMode';
import * as mockApi from './mockApi';
import * as realApi from './realApi';

// The adapter is fixed at build time so presentation components stay unaware
// of whether they talk to the in-memory mock or to the serverless backend.
const adapter = executionMode === 'mock' ? mockApi : realApi;

export const getEvent = adapter.getEvent;
export const getEvents = adapter.getEvents;
type ErrorStage = 'registration' | 'upload' | 'polling';
const errorCounts: Record<ErrorStage, number> = {
  registration: 0,
  upload: 0,
  polling: 0,
};
/** Session-only counts: no identities, URLs, tokens or persisted telemetry. */
export function getEnrollmentErrorCounts(): Readonly<
  Record<ErrorStage, number>
> {
  return { ...errorCounts };
}
async function counted<T>(
  stage: ErrorStage,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    errorCounts[stage] += 1;
    throw error;
  }
}
export const createRegistration: typeof adapter.createRegistration = (
  ...args
) => counted('registration', () => adapter.createRegistration(...args));
export const uploadFileToS3: typeof adapter.uploadFileToS3 = (...args) =>
  counted('upload', () => adapter.uploadFileToS3(...args));
export const getRegistrationStatus: typeof adapter.getRegistrationStatus = (
  ...args
) => counted('polling', () => adapter.getRegistrationStatus(...args));
