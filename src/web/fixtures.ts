import type { Event, RegistrationStatusResponse } from './types';

export const DEMO_EVENT: Event = {
  id: 'demo-2026',
  name: 'Findly Demo Night',
  date: '2026-09-18T19:30:00+02:00',
  location: 'Barcelona · Espai Metrònom',
  description:
    'Comparte tu selfie y te enviaremos un enlace privado con las fotografías en las que apareces.',
};

const statusReads = new Map<string, number>();
export function resetMockState() {
  statusReads.clear();
}
export function nextMockStatus(
  registrationId: string,
): RegistrationStatusResponse {
  const reads = (statusReads.get(registrationId) ?? 0) + 1;
  statusReads.set(registrationId, reads);
  return reads >= 2
    ? {
        registrationId,
        status: 'ENROLLED',
        message:
          'Tu selfie está lista. Te enviaremos el enlace a tu galería privada por email.',
      }
    : {
        registrationId,
        status: 'PROCESSING',
        message:
          'Estamos preparando tu registro. Esto tardará solo unos instantes.',
      };
}
