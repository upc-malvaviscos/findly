import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  memoriaTag,
  publishMemoria,
  completedMemoriaRelease,
} from '../../scripts/lib/memoria-release.mjs';

type Release = {
  id: number;
  tag_name: string;
  target_commitish: string;
  body: string;
  draft: boolean;
  html_url: string;
  assets: { name: string; state: string }[];
};
const sha = 'a'.repeat(40);
const context = {
  eventName: 'push',
  ref: 'refs/heads/main',
  sha,
  runId: 123,
  repo: { owner: 'upc-malvaviscos', repo: 'findly' },
};
const missing = () =>
  Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-release-'));
  directories.push(directory);
  const pdfPath = join(directory, 'memoria.pdf');
  writeFileSync(pdfPath, '%PDF-1.7\nsynthetic test fixture');
  const release: Release = {
    id: 7,
    tag_name: 'memoria-2026-10-25_18-45',
    target_commitish: sha,
    body: `<!-- memoria-source:${sha} -->`,
    draft: true,
    html_url:
      'https://github.com/upc-malvaviscos/findly/releases/tag/memoria-2026-10-25_18-45',
    assets: [],
  };
  const github = {
    paginate: vi.fn(async () => [] as Release[]),
    rest: {
      git: { getRef: vi.fn<() => Promise<{ data: unknown }>>(missing) },
      repos: {
        listReleases: vi.fn(),
        compareCommitsWithBasehead: vi.fn(async () => ({
          data: { status: 'identical' },
        })),
        getReleaseByTag: vi.fn<() => Promise<{ data: Release }>>(missing),
        createRelease: vi.fn(async () => ({ data: release })),
        uploadReleaseAsset: vi.fn(async () => ({ data: {} })),
        updateRelease: vi.fn(async () => ({
          data: { ...release, draft: false },
        })),
        getCommit: vi.fn(async () => ({ data: { sha } })),
      },
    },
  };
  return {
    github,
    context,
    pdfPath,
    release,
    now: () => new Date('2026-10-25T17:45:00Z'),
    sleep: vi.fn(async () => {}),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});

describe('memoria release timestamp', () => {
  it('uses Madrid winter/summer time, zero-padded fields and a 24-hour clock', () => {
    expect(memoriaTag(new Date('2026-01-02T23:05:00Z'))).toBe(
      'memoria-2026-01-03_00-05',
    );
    expect(memoriaTag(new Date('2026-07-02T16:09:00Z'))).toBe(
      'memoria-2026-07-02_18-09',
    );
  });
  it('exposes the repeated local minute at the DST fold to collision handling', () => {
    expect(memoriaTag(new Date('2026-10-25T00:30:00Z'))).toBe(
      memoriaTag(new Date('2026-10-25T01:30:00Z')),
    );
  });
});

describe('memoria release publication', () => {
  it('detects an existing completed release before another build', async () => {
    const options = fixture();
    options.release.draft = false;
    options.release.assets = [{ name: 'memoria.pdf', state: 'uploaded' }];
    options.github.paginate.mockResolvedValue([options.release]);
    expect(
      await completedMemoriaRelease(options.github, context.repo, sha),
    ).toBe(options.release.html_url);
    expect(options.github.rest.repos.createRelease).not.toHaveBeenCalled();
  });
  it('deduplicates separate workflow runs for the same source commit', async () => {
    const options = fixture();
    options.release.draft = false;
    options.release.assets = [{ name: 'memoria.pdf', state: 'uploaded' }];
    options.github.paginate.mockResolvedValue([options.release]);
    await publishMemoria({
      ...options,
      context: { ...context, eventName: 'workflow_run', runId: 456 },
    });
    expect(options.github.rest.repos.createRelease).not.toHaveBeenCalled();
    expect(options.github.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled();
  });
  it('uploads PDF bytes to a draft before making it visible', async () => {
    const options = fixture();
    expect(await publishMemoria(options)).toBe(options.release.html_url);
    expect(options.github.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: options.release.tag_name,
        target_commitish: sha,
        draft: true,
        make_latest: 'false',
      }),
    );
    expect(options.github.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'memoria.pdf',
        release_id: 7,
        data: expect.any(Buffer),
      }),
    );
    expect(options.github.rest.repos.uploadReleaseAsset).toHaveBeenCalledBefore(
      options.github.rest.repos.updateRelease,
    );
  });
  it('does not publish when upload fails', async () => {
    const options = fixture();
    options.github.rest.repos.uploadReleaseAsset.mockRejectedValue(
      new Error('Upload failed'),
    );
    await expect(publishMemoria(options)).rejects.toThrow('Upload failed');
    expect(options.github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });
  it('resumes a draft with an already completed upload without replacing it', async () => {
    const options = fixture();
    options.release.assets = [{ name: 'memoria.pdf', state: 'uploaded' }];
    options.github.paginate.mockResolvedValue([options.release]);
    await publishMemoria(options);
    expect(options.github.rest.repos.createRelease).not.toHaveBeenCalled();
    expect(options.github.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled();
    expect(options.github.rest.repos.updateRelease).toHaveBeenCalledOnce();
  });
  it('returns a completed release on rerun without mutations', async () => {
    const options = fixture();
    options.release.draft = false;
    options.release.assets = [{ name: 'memoria.pdf', state: 'uploaded' }];
    options.github.paginate.mockResolvedValue([options.release]);
    await publishMemoria(options);
    expect(options.github.rest.repos.createRelease).not.toHaveBeenCalled();
    expect(options.github.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled();
    expect(options.github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });
  it('waits for the next minute when another release occupies the timestamp', async () => {
    const options = fixture();
    options.github.rest.repos.getReleaseByTag.mockResolvedValueOnce({
      data: options.release,
    });
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-10-25T17:45:00Z'))
      .mockReturnValue(new Date('2026-10-25T17:46:01Z'));
    await publishMemoria({ ...options, now });
    expect(options.sleep).toHaveBeenCalledWith(61_000);
    expect(options.github.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ tag_name: 'memoria-2026-10-25_18-46' }),
    );
  });
  it('also preserves existing tags with no release', async () => {
    const options = fixture();
    options.github.rest.git.getRef.mockResolvedValueOnce({
      data: { object: { sha } },
    });
    await publishMemoria(options);
    expect(options.sleep).toHaveBeenCalledOnce();
  });
  it('fails closed on API errors rather than treating them as a free tag', async () => {
    const options = fixture();
    options.github.rest.repos.getReleaseByTag.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );
    await expect(publishMemoria(options)).rejects.toThrow('Forbidden');
    expect(options.github.rest.repos.createRelease).not.toHaveBeenCalled();
  });
  it('refuses publication if a tag changes to another source', async () => {
    const options = fixture();
    options.github.paginate.mockResolvedValue([options.release]);
    options.github.rest.git.getRef.mockResolvedValue({
      data: { object: { sha: 'b'.repeat(40) } },
    });
    options.github.rest.repos.getCommit.mockResolvedValue({
      data: { sha: 'b'.repeat(40) },
    });
    await expect(publishMemoria(options)).rejects.toThrow('another commit');
    expect(options.github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });
  it('rejects PR publication and invalid PDF input before calling GitHub', async () => {
    const options = fixture();
    await expect(
      publishMemoria({
        ...options,
        context: { ...context, eventName: 'pull_request' },
      }),
    ).rejects.toThrow('authorized main event');
    writeFileSync(options.pdfPath, 'not a PDF');
    await expect(publishMemoria(options)).rejects.toThrow('Invalid PDF');
    expect(options.github.paginate).not.toHaveBeenCalled();
  });
});

describe('container conversion diagnostics', () => {
  it.each([
    ['[WARNING] Could not fetch resource missing.png', 0, 1],
    ['WARNING: Reference not found: fig:missing', 0, 1],
    ['Missing character: There is no glyph in font', 0, 1],
    ['conversion failed', 1, 1],
    ['', 0, 0],
  ])(
    'handles converter stderr %s and exit %i',
    (diagnostic, status, expected) => {
      const directory = mkdtempSync(join(tmpdir(), 'memoria-converter-'));
      directories.push(directory);
      writeFileSync(
        join(directory, 'docker'),
        `#!/usr/bin/env node\nconsole.error(${JSON.stringify(diagnostic)}); process.exit(${status});\n`,
        { mode: 0o755 },
      );
      const script = fileURLToPath(
        new URL('../../scripts/pandoc-container.mjs', import.meta.url),
      );
      const result = spawnSync(process.execPath, [script, '--version'], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        encoding: 'utf8',
      });
      expect(result.status).toBe(expected);
      expect(result.stderr).toContain(diagnostic);
    },
  );
});
