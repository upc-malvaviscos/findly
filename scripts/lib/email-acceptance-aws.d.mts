export interface AcceptanceCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}
export function acceptanceAwsCommand(
  service: string,
  action: string,
): new (input: Record<string, unknown>) => unknown;
export function createAcceptanceAws(
  credentials?: AcceptanceCredentials,
): (
  service: string,
  action: string,
  input?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
