import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProcess } from 'node:child_process';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { createHash } from 'node:crypto';

const processMocks = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawnSync: processMocks.run,
  spawn: processMocks.spawn,
}));
const dynamo = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);
const outputs = {
  api_endpoint: { value: 'https://api.test' },
  table_name: { value: 'synthetic-table' },
  uploads_bucket_name: { value: 'synthetic-bucket' },
  cognito_user_pool_id: { value: 'synthetic-pool' },
  cognito_client_id: { value: 'synthetic-client' },
};

beforeEach(() => {
  vi.resetModules();
  dynamo.reset();
  s3.reset();
  processMocks.run.mockReset();
  processMocks.spawn.mockReset();
  vi.stubEnv('FINDLY_TERRAFORM_STATE_BUCKET', 'synthetic-state');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  processMocks.run.mockImplementation((_file: string, args: string[]) => ({
    status: 0,
    stdout: args.includes('export-credentials')
      ? JSON.stringify({
          AccessKeyId: 'synthetic-key',
          SecretAccessKey: 'synthetic-secret',
        })
      : args.includes('output')
        ? JSON.stringify(outputs)
        : args.includes('get-caller-identity')
          ? '123456789012'
          : args.includes('initiate-auth')
            ? 'synthetic-id-token'
            : '',
    stderr: '',
  }));
  dynamo.resolves({});
  s3.resolves({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/admin/events')
        return new Response(JSON.stringify({ eventId: 'synthetic-event' }), {
          status: init?.method === 'POST' ? 200 : 401,
        });
      if (path.endsWith('/photos/uploads'))
        return Response.json({
          uploads: [
            {
              photoId: 'synthetic-photo',
              uploadUrl: 'https://upload.test/file',
            },
          ],
        });
      if (path === '/file') return new Response('', { status: 200 });
      if (path === '/image')
        return new Response('JPEG', {
          headers: { 'content-type': 'image/jpeg' },
        });
      const token = new URL(url).searchParams.get('token') ?? '';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const rows = dynamo
        .commandCalls(PutCommand)
        .flatMap((call) => call.args[0].input.Item ?? []);
      const gallery = rows.find((row) => row.PK === `TOKEN#${tokenHash}`);
      if (!gallery)
        return Response.json({ code: 'GALLERY_NOT_FOUND' }, { status: 404 });
      if (gallery.expiresAt < new Date().toISOString())
        return Response.json({ code: 'GALLERY_EXPIRED' }, { status: 410 });
      const matches = rows.filter(
        (row) => row.PK === `REG#${gallery.registrationId}`,
      );
      return Response.json({
        eventId: gallery.eventId,
        photos: matches.map(() => ({ url: 'https://api.test/image' })),
      });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const smoke = () =>
  import(new URL('../../scripts/test-aws-sandbox.mjs', import.meta.url).href);
const session = () =>
  import(new URL('../../scripts/aws-sandbox.mjs', import.meta.url).href);

describe('sandbox script entrypoints with synthetic AWS clients', () => {
  it('reports smoke success only after every fixture deletion succeeds', async () => {
    await smoke();
    expect(dynamo.commandCalls(DeleteCommand)).toHaveLength(8);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(2);
    expect(console.log).toHaveBeenCalledWith(
      'AWS sandbox smoke and fixture cleanup passed with synthetic data.',
    );
    expect(
      processMocks.run.mock.calls.some((call) =>
        call[1].includes('admin-delete-user'),
      ),
    ).toBe(true);
  });
  it('cleans the event and photo even when the presigned PUT fails', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockImplementationOnce(async () => new Response('', { status: 401 }))
      .mockImplementationOnce(async () =>
        Response.json({ eventId: 'synthetic-event' }),
      )
      .mockImplementationOnce(async () =>
        Response.json({
          uploads: [
            {
              photoId: 'synthetic-photo',
              uploadUrl: 'https://upload.test/file',
            },
          ],
        }),
      )
      .mockImplementationOnce(async () => new Response('', { status: 403 }));
    await expect(smoke()).rejects.toThrow('Presigned upload returned 403');
    expect(dynamo.commandCalls(DeleteCommand)).toHaveLength(2);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(1);
    expect(console.log).not.toHaveBeenCalled();
  });
  it('awaits late fixture writes before deleting after a partial write failure', async () => {
    const sequence: string[] = [];
    dynamo.on(PutCommand).callsFake(async (input) => {
      if (input.Item.SK === 'METADATA') throw new Error('failed fixture');
      await new Promise((resolve) => setTimeout(resolve, 10));
      sequence.push('write');
      return {};
    });
    dynamo.on(DeleteCommand).callsFake(async () => {
      sequence.push('delete');
      return {};
    });
    await expect(smoke()).rejects.toThrow(
      'Could not create every sandbox gallery fixture',
    );
    expect(sequence.lastIndexOf('write')).toBeLessThan(
      sequence.indexOf('delete'),
    );
    expect(dynamo.commandCalls(DeleteCommand)).toHaveLength(8);
  });
  it('cleans the gallery object after an uncertain upload failure', async () => {
    s3.on(PutObjectCommand).rejects(new Error('synthetic timeout'));
    await expect(smoke()).rejects.toThrow('synthetic timeout');
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(2);
    expect(dynamo.commandCalls(DeleteCommand)).toHaveLength(8);
    expect(console.log).not.toHaveBeenCalled();
  });
  it('fails the smoke after a failed deletion without leaking the provider response', async () => {
    dynamo.on(DeleteCommand).rejects(new Error('private-provider-response'));
    await expect(smoke()).rejects.toThrow('Sandbox cleanup incomplete');
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(2);
    expect(console.log).not.toHaveBeenCalled();
  });
  it('removes the organizer if password setup fails before starting Vite', async () => {
    const defaultRun = processMocks.run.getMockImplementation();
    processMocks.run.mockImplementation((file, args) =>
      args.includes('admin-set-user-password')
        ? { status: 1, stdout: '', stderr: 'synthetic password failure' }
        : defaultRun?.(file, args),
    );
    await expect(session()).rejects.toThrow('synthetic password failure');
    expect(processMocks.spawn).not.toHaveBeenCalled();
    expect(
      processMocks.run.mock.calls.some((call) =>
        call[1].includes('admin-delete-user'),
      ),
    ).toBe(true);
  });
  it('fails the session if organizer deletion fails after a clean server exit', async () => {
    const defaultRun = processMocks.run.getMockImplementation();
    processMocks.run.mockImplementation((file, args) =>
      args.includes('admin-delete-user')
        ? { status: 1, stdout: '', stderr: 'AccessDenied' }
        : defaultRun?.(file, args),
    );
    processMocks.spawn.mockImplementation(() => {
      const child = new ChildProcess();
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    });
    await expect(session()).rejects.toThrow('Sandbox cleanup incomplete');
  });
});
