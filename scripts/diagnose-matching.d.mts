export function sanitizeMatchingLogs(
  events: Array<{ message?: string; timestamp?: number }>,
): Array<Record<string, string | number>>;
