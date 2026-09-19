import { executionMode } from './executionMode';
import * as mockApi from './mockApi';
import * as realApi from './realApi';

// The adapter is fixed at build time so presentation components stay unaware
// of whether they talk to the in-memory mock or to the serverless backend.
const adapter = executionMode === 'mock' ? mockApi : realApi;

export const getEvent = adapter.getEvent;
export const createRegistration = adapter.createRegistration;
export const uploadFileToS3 = adapter.uploadFileToS3;
export const getRegistrationStatus = adapter.getRegistrationStatus;
