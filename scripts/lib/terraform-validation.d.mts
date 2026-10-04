import type { SpawnSyncOptions } from 'node:child_process';
export type TerraformRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptions,
) => { status: number | null; error?: Error };
export const terraformRoots: string[];
export function validateTerraform(options?: {
  repository?: string;
  run?: TerraformRunner;
}): void;
