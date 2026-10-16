// Opaque, client-facing pagination cursor: a base64url JSON encoding of a
// DynamoDB LastEvaluatedKey. Safe to expose here because every field in an
// admin-facing key (event/photo/registration ids) is already known to the
// caller, who is viewing that event's own photo list.

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
