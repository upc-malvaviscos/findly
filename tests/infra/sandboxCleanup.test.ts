import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ChildProcess } from 'node:child_process';
import {
  deleteSandboxOrganizer,
  runSandboxSession,
  withCleanup,
} from '../../scripts/lib/sandbox-cleanup.mjs';

describe('sandbox cleanup failure propagation', () => {
  it('awaits all deletions, including synchronous failures, and never reports success with incomplete cleanup', async () => {
    const finished = vi.fn();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = withCleanup((cleanup) => {
      cleanup.add('first resource', async () => {
        await pending;
        finished();
      });
      cleanup.add('second resource', () => {
        throw new Error('sensitive-provider-output');
      });
      cleanup.add('third resource', async () => {
        throw new Error('secret-token');
      });
    });
    const result = expect(work).rejects.toMatchObject({
      errors: [
        new Error('Cleanup failed: third resource.'),
        new Error('Cleanup failed: second resource.'),
      ],
    });
    expect(finished).not.toHaveBeenCalled();
    release();
    await result;
    expect(finished).toHaveBeenCalledOnce();
  });
  it('retains both the original failure and every cleanup failure', async () => {
    const primary = new Error('synthetic smoke failure');
    await expect(
      withCleanup((cleanup) => {
        cleanup.add('fixture row', async () => {
          throw new Error('provider-output');
        });
        throw primary;
      }),
    ).rejects.toMatchObject({
      errors: [primary, new Error('Cleanup failed: fixture row.')],
    });
  });
  it('preserves the original error if cleanup succeeds and the return value on complete success', async () => {
    const original = new Error('original');
    await expect(
      withCleanup(() => {
        throw original;
      }),
    ).rejects.toBe(original);
    await expect(withCleanup(() => 42)).resolves.toBe(42);
  });
  it.each(['create', 'configure', 'spawn'])(
    'removes the organizer when %s fails during startup',
    async (phase) => {
      const remove = vi.fn();
      const attempt = (name: string) => {
        if (name === phase) throw new Error(`failed ${name}`);
      };
      await expect(
        runSandboxSession({
          createUser: () => attempt('create'),
          configureUser: () => attempt('configure'),
          startServer: () => {
            attempt('spawn');
            return new ChildProcess();
          },
          deleteUser: remove,
        }),
      ).rejects.toThrow(`failed ${phase}`);
      expect(remove).toHaveBeenCalledOnce();
    },
  );
  it.each(['exit', 'error', 'signal'])(
    'reports failed deletion after server %s and detaches signal handlers',
    async (scenario) => {
      const server = new ChildProcess();
      const signals = new EventEmitter();
      const kill = vi.spyOn(server, 'kill').mockImplementation(() => {
        server.emit('exit', null, 'SIGTERM');
        return true;
      });
      const session = runSandboxSession({
        createUser: () => {},
        configureUser: () => {},
        startServer: () => server,
        signals,
        deleteUser: () => {
          throw new Error('sensitive deletion error');
        },
      });
      const result = expect(session).rejects.toThrow(
        'Sandbox cleanup incomplete',
      );
      await vi.waitFor(() => expect(server.listenerCount('exit')).toBe(1));
      if (scenario === 'signal') signals.emit('SIGINT');
      else if (scenario === 'error')
        server.emit('error', new Error('spawn failed'));
      else server.emit('exit', 0, null);
      await result;
      expect(signals.listenerCount('SIGINT')).toBe(0);
      expect(signals.listenerCount('SIGTERM')).toBe(0);
      expect(kill).toHaveBeenCalledTimes(scenario === 'signal' ? 1 : 0);
    },
  );
  it('treats a confirmed missing organizer as already cleaned but propagates authorization errors', () => {
    expect(() =>
      deleteSandboxOrganizer(() => {
        throw new Error(
          'An error occurred (UserNotFoundException) when calling the AdminDeleteUser operation: gone',
        );
      }),
    ).not.toThrow();
    expect(() =>
      deleteSandboxOrganizer(() => {
        throw new Error('AccessDenied: secret');
      }),
    ).toThrow('Temporary organizer deletion failed.');
  });
});
