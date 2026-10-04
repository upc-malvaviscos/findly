import type {
  EmailAcceptanceFixture,
  EmailAcceptanceManifest,
} from './email-acceptance-manifest.mjs';
export interface AcceptanceRow {
  PK: string;
  SK: string;
  [name: string]: unknown;
}
export interface AcceptanceStatus {
  status: string;
  [name: string]: string | number;
}
export interface DeadLetter {
  Body: string;
  ReceiptHandle: string;
}
export interface RecipientEvidence {
  received: boolean;
  opened: boolean;
  folder: 'inbox' | 'spam';
  spf: string;
  dkim: string;
  dmarc: string;
}
export interface EmailAcceptanceAdapter {
  preflight(): Promise<void>;
  api(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    expected?: number,
  ): Promise<AcceptanceStatus>;
  erase(registrationId: string, capability: string): Promise<void>;
  put(item: AcceptanceRow): Promise<void>;
  get(key: { PK: string; SK: string }): Promise<AcceptanceRow | undefined>;
  query(pk: string): Promise<AcceptanceRow[]>;
  delete(key: { PK: string; SK: string }): Promise<void>;
  revokeEvent(eventId: string): Promise<void>;
  removeCursor(eventId: string, operationId: string): Promise<void>;
  createCollection(collectionId: string): Promise<void>;
  deleteCollection(collectionId: string): Promise<void>;
  collectionExists(collectionId: string): Promise<boolean>;
  uploadPhoto(key: string): Promise<void>;
  deletePhoto(key: string): Promise<void>;
  photoExists(key: string): Promise<boolean>;
  photoProcessed(eventId: string, photoId: string): Promise<boolean>;
  receiveDeadLetters(): Promise<DeadLetter[]>;
  releaseDeadLetter(receipt: string): Promise<void>;
  deleteDeadLetter(receipt: string): Promise<void>;
  sendWork(body: string, deduplication: string): Promise<void>;
  invokeWorker(payload: { Records: Array<{ body: string }> }): Promise<void>;
  invokeFeedback(payload: { Records: Array<{ body: string }> }): Promise<void>;
  suppressed(address: string): Promise<boolean>;
  addSuppression(address: string): Promise<void>;
  removeSuppression(address: string): Promise<void>;
  cleanupQueues(
    fixtures: EmailAcceptanceFixture[],
    budgetMs: number,
  ): Promise<void>;
}
export interface EmailAcceptanceInputs {
  manifest: EmailAcceptanceManifest;
  outputs: Record<string, { value: unknown }>;
  jwt: string;
  recipients?: string[];
}
export interface EmailAcceptanceOptions extends EmailAcceptanceInputs {
  adapter: EmailAcceptanceAdapter;
  wait(milliseconds: number): Promise<void>;
  now?: () => number;
  phase?: 'synthetic' | 'recipients';
  confirmRecipientEvidence?: (
    fixture: EmailAcceptanceFixture,
  ) => Promise<RecipientEvidence[]>;
  pollTimeoutMs?: number;
  dlqTimeoutMs?: number;
  cleanupQuiescenceMs?: number;
  executionBudgetMs?: number;
}
export function requireAcceptanceInputs(inputs: EmailAcceptanceInputs): void;
export function isOwnedAcceptanceMessage(
  body: string,
  fixtures: EmailAcceptanceFixture[],
): boolean;
export function moveExactAcceptanceMessage(options: {
  fixture: EmailAcceptanceFixture;
  adapter: EmailAcceptanceAdapter;
  timeoutMs: number;
  wait(milliseconds: number): Promise<void>;
  now(): number;
}): Promise<void>;
export function runEmailAcceptance(options: EmailAcceptanceOptions): Promise<{
  results: Array<{ scenario: string; outcome: string; count: number }>;
  cleanup: string;
  originatingCrash: string;
  concurrentErasure: string;
  realRecipients: string;
}>;
