import { vi } from 'vitest';

export type LogRecord = Record<string, unknown>;

/** Captures everything the handlers write through console, in call order. */
export function captureLogs() {
  const lines: string[] = [];
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    }),
  );
  return {
    lines,
    records: (): LogRecord[] =>
      lines.map((line) => JSON.parse(line) as LogRecord),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
