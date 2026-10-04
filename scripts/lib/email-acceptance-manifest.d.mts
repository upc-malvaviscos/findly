export interface EmailAcceptanceRegistration {
  registrationId: string;
  capability: string;
  tokenHash: string;
}
export interface EmailAcceptanceFixture {
  scenario: string;
  eventId: string;
  operationId: string;
  photoId: string;
  photoKey: string;
  collectionId: string;
  registrations: EmailAcceptanceRegistration[];
}
export interface EmailAcceptanceManifest {
  version: 1;
  account: string;
  region: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  fixtures: EmailAcceptanceFixture[];
  leadingKeys: string[];
  suppressionAddress: string;
}
export const emailAcceptanceScenarios: string[];
export function createEmailAcceptanceManifest(options?: {
  now?: number;
  runId?: string;
}): EmailAcceptanceManifest;
export function validateEmailAcceptanceManifest(
  manifest: unknown,
  options?: { now?: number; allowExpired?: boolean },
): EmailAcceptanceManifest;
