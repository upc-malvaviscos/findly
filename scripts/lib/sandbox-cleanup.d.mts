import type { ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
export type Cleanup = {
  add(label: string, run: () => unknown | Promise<unknown>): void;
};
export function withCleanup<T>(
  work: (cleanup: Cleanup) => T | Promise<T>,
): Promise<T>;
export function waitForServer(
  server: ChildProcess,
  signals?: EventEmitter,
): Promise<void>;
export function runSandboxSession(options: {
  createUser: () => unknown;
  configureUser: () => unknown;
  startServer: () => ChildProcess;
  deleteUser: () => unknown;
  signals?: EventEmitter;
}): Promise<void>;
export function deleteSandboxOrganizer(remove: () => unknown): void;
