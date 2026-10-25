import { describe, expect, it, vi } from 'vitest';
import {
  affectsMemoria,
  resolveMemoriaSource,
  verifyMainCommit,
} from '../../scripts/lib/memoria-source.mjs';
import type {
  MemoriaPull,
  MemoriaSourceContext,
} from '../../scripts/lib/memoria-source.mjs';

const head = 'a'.repeat(40);
const merged = 'b'.repeat(40);
const repository = { owner: 'upc-malvaviscos', repo: 'findly' };
const fullName = 'upc-malvaviscos/findly';

function fixture() {
  const pr: MemoriaPull = {
    merged: true,
    merge_commit_sha: merged,
    changed_files: 1,
    auto_merge: null,
    base: { ref: 'main', repo: { full_name: fullName } },
    head: { sha: head, repo: { full_name: fullName } },
  };
  const context: MemoriaSourceContext = {
    eventName: 'workflow_run',
    ref: 'refs/heads/main',
    sha: 'c'.repeat(40),
    repo: repository,
    payload: {
      workflow_run: {
        name: 'CI',
        conclusion: 'success',
        head_sha: head,
        head_repository: { full_name: fullName },
        pull_requests: [{ number: 187 }],
      },
    },
  };
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: vi.fn(async () => ({
          data: { status: 'ahead' },
        })),
        listPullRequestsAssociatedWithCommit: vi.fn(async () => ({
          data: [{ number: 187 }],
        })),
      },
      pulls: {
        get: vi.fn(async () => ({ data: pr })),
        listFiles: vi.fn(async () => ({
          data: [
            { filename: 'docs/paper/memoria-findly/memoria-postgrado.md' },
          ],
        })),
      },
    },
  };
  return { context, github, pr, sleep: vi.fn(async () => {}) };
}

describe('verified PDF publication source', () => {
  it('recognizes native CodeQL metadata by its stable path, not its dynamic run name', async () => {
    const options = fixture();
    if (options.context.payload.workflow_run) {
      options.context.payload.workflow_run.name = 'Push on main';
      options.context.payload.workflow_run.path =
        'dynamic/github-code-scanning/codeql';
      options.context.payload.workflow_run.head_sha = merged;
    }
    expect(await resolveMemoriaSource(options)).toEqual({
      sha: merged,
      pullNumber: 187,
    });
  });
  it('selects the merged main commit, not the PR head or current main HEAD', async () => {
    const options = fixture();
    expect(await resolveMemoriaSource(options)).toEqual({
      sha: merged,
      pullNumber: 187,
    });
    expect(
      options.github.rest.repos.compareCommitsWithBasehead,
    ).toHaveBeenCalledWith({
      ...repository,
      basehead: `${merged}...main`,
      per_page: 1,
    });
  });

  it('waits for the check-completion/auto-merge race, then verifies the merged source', async () => {
    const options = fixture();
    options.github.rest.pulls.get.mockResolvedValueOnce({
      data: {
        ...options.pr,
        merged: false,
        merge_commit_sha: null,
        auto_merge: {},
      },
    });
    expect(await resolveMemoriaSource(options)).toEqual({
      sha: merged,
      pullNumber: 187,
    });
    expect(options.sleep).toHaveBeenCalledWith(5000);
  });

  it('bounds waiting for an auto-merge that never occurs', async () => {
    const options = fixture();
    options.pr.merged = false;
    options.pr.auto_merge = {};
    expect(await resolveMemoriaSource(options)).toBeUndefined();
    expect(options.sleep).toHaveBeenCalledTimes(24);
    expect(options.github.rest.pulls.listFiles).not.toHaveBeenCalled();
  });

  it.each([
    'fork',
    'failed',
    'unmerged',
    'other-base',
    'stale-head',
    'foreign-event',
    'other-ref',
  ])('rejects %s without selecting build code', async (scenario) => {
    const options = fixture();
    if (scenario === 'fork')
      options.pr.head.repo = { full_name: 'outsider/fork' };
    if (scenario === 'failed' && options.context.payload.workflow_run)
      options.context.payload.workflow_run.conclusion = 'failure';
    if (scenario === 'unmerged') options.pr.merged = false;
    if (scenario === 'other-base') options.pr.base.ref = 'develop';
    if (scenario === 'stale-head') {
      options.pr.head.sha = 'd'.repeat(40);
      options.pr.merge_commit_sha = 'e'.repeat(40);
    }
    if (scenario === 'foreign-event')
      options.context.eventName = 'pull_request';
    if (scenario === 'other-ref') options.context.ref = 'refs/heads/feature';
    expect(await resolveMemoriaSource(options)).toBeUndefined();
    expect(options.github.rest.pulls.listFiles).not.toHaveBeenCalled();
  });

  it('rejects an untrusted workflow run repository before querying PRs', async () => {
    const options = fixture();
    if (options.context.payload.workflow_run)
      options.context.payload.workflow_run.head_repository = {
        full_name: 'outsider/fork',
      };
    expect(await resolveMemoriaSource(options)).toBeUndefined();
    expect(options.github.rest.pulls.get).not.toHaveBeenCalled();
  });

  it('does not select a relevant PR whose merge commit is not in main', async () => {
    const options = fixture();
    options.github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
      data: { status: 'diverged' },
    });
    await expect(resolveMemoriaSource(options)).rejects.toThrow(
      'ancestor of main',
    );
    expect(options.github.rest.pulls.listFiles).not.toHaveBeenCalled();
  });

  it('ignores unrelated merged text changes', async () => {
    const options = fixture();
    options.github.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'README.md' }],
    });
    expect(await resolveMemoriaSource(options)).toBeUndefined();
  });

  it('checks files beyond the first page', async () => {
    const options = fixture();
    options.pr.changed_files = 101;
    options.github.rest.pulls.listFiles.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, i) => ({
        filename: `docs/unrelated-${i}.md`,
      })),
    });
    expect(await resolveMemoriaSource(options)).toEqual({
      sha: merged,
      pullNumber: 187,
    });
    expect(options.github.rest.pulls.listFiles).toHaveBeenCalledTimes(2);
  });

  it('fails closed on incomplete file enumeration', async () => {
    const options = fixture();
    options.pr.changed_files = 2;
    await expect(resolveMemoriaSource(options)).rejects.toThrow('Incomplete');
  });

  it.each(['push', 'workflow_dispatch'])(
    'verifies an associated merged PR for %s on main',
    async (eventName) => {
      const options = fixture();
      options.context.eventName = eventName;
      options.context.sha = merged;
      options.context.payload = {};
      expect(await resolveMemoriaSource(options)).toEqual({
        sha: merged,
        pullNumber: 187,
      });
      expect(
        options.github.rest.repos.listPullRequestsAssociatedWithCommit,
      ).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: merged }));
    },
  );

  it('supports recovery of a specific verified merged commit', async () => {
    const options = fixture();
    options.context.eventName = 'workflow_dispatch';
    options.context.payload = { inputs: { source_sha: merged } };
    expect(await resolveMemoriaSource(options)).toEqual({
      sha: merged,
      pullNumber: 187,
    });
  });

  it('rejects malformed recovery input before any API calls', async () => {
    const options = fixture();
    options.context.eventName = 'workflow_dispatch';
    options.context.payload = { inputs: { source_sha: 'refs/pull/1/head' } };
    await expect(resolveMemoriaSource(options)).rejects.toThrow(
      'Invalid trigger commit',
    );
    expect(options.github.rest.pulls.get).not.toHaveBeenCalled();
  });

  it('verifies the exact source SHA syntax', async () => {
    const { github } = fixture();
    await expect(verifyMainCommit(github, repository, 'main')).rejects.toThrow(
      'Invalid source commit',
    );
  });

  it('limits relevant paths to the PDF inputs and tooling', () => {
    expect(affectsMemoria('docs/paper/memoria-findly/img/cover.png')).toBe(
      true,
    );
    expect(affectsMemoria('scripts/lib/memoria-source.mjs')).toBe(true);
    expect(affectsMemoria('README.md')).toBe(false);
    expect(affectsMemoria('package.json')).toBe(false);
  });
});
