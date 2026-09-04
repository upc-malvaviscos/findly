import { DEMO_EVENT, nextMockStatus } from './fixtures';
import type {
  RegistrationRequest,
  RegistrationResponse,
  RegistrationStatusResponse,
  UploadProgress,
} from './types';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
export async function getEvent(eventId: string) {
  await wait(80);
  return eventId === DEMO_EVENT.id ? DEMO_EVENT : null;
}
export async function createRegistration(
  request: RegistrationRequest,
): Promise<RegistrationResponse> {
  await wait(120);
  const registrationKey = `${request.eventId}-${request.email.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()}`;
  return {
    registrationId: `reg-${registrationKey}`,
    uploadUrl: 'mock://findly/selfies/upload',
    expiresInSeconds: 300,
  };
}
export async function uploadFileToS3(
  _uploadUrl: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
) {
  if (file.name.toLowerCase().includes('fail-upload'))
    throw new Error('UPLOAD_FAILED');
  const total = Math.max(file.size, 1);
  for (const percentage of [25, 50, 75, 100]) {
    await wait(45);
    onProgress({
      loaded: Math.round((total * percentage) / 100),
      total,
      percentage,
    });
  }
}
export async function getRegistrationStatus(
  registrationId: string,
): Promise<RegistrationStatusResponse> {
  await wait(80);
  return nextMockStatus(registrationId);
}
