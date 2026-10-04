export interface EvidenceComment {
  body?: string;
  created_at: string;
  user?: { login?: string };
}
export interface ReceiptEvidence {
  spf: 'pass';
  dkim: 'pass';
  dmarc: 'pass';
  folder: 'inbox' | 'spam';
  opened: true;
}
export function hasSyntheticEvidence(
  comments: EvidenceComment[],
  runId: string,
  startedAt: string,
): boolean;
export function recipientEvidence(
  comments: EvidenceComment[],
  runId: string,
  startedAt: string,
): Partial<Record<'A' | 'B', ReceiptEvidence>>;

export function requireAcceptanceTimeBudget(
  manifest: { expiresAt: string },
  now?: number,
): void;
