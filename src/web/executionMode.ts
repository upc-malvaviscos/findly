export type ExecutionMode = 'mock' | 'floci' | 'aws';

export function resolveExecutionMode(
  developmentBuild: boolean,
  requestedMode: string | undefined,
): ExecutionMode {
  return developmentBuild && requestedMode === 'mock'
    ? 'mock'
    : requestedMode === 'floci'
      ? 'floci'
      : 'aws';
}

/** Mock services are only available in Vite development builds. */
export const executionMode = resolveExecutionMode(
  import.meta.env.DEV,
  import.meta.env.VITE_FINDLY_EXECUTION_MODE,
);
