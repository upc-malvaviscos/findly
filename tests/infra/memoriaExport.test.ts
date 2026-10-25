import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportMemoriaSources } from '../../scripts/lib/memoria-export.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-export-'));
  directories.push(directory);
  const repository = join(directory, 'repository');
  const destination = join(directory, 'document');
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const paper = join(repository, 'docs/paper/memoria-findly');
  mkdirSync(join(paper, 'img'), { recursive: true });
  writeFileSync(join(paper, 'memoria-postgrado.md'), '# Synthetic source');
  writeFileSync(join(paper, 'portada.tex'), 'Synthetic cover');
  writeFileSync(join(paper, 'img', 'diagram.png'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(
    join(paper, 'Makefile'),
    '$(error Historical code must never execute)',
  );
  git('init', '--quiet', '--initial-branch=main');
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Synthetic fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const sha = commit();
  git('update-ref', 'refs/remotes/origin/main', sha);
  return { repository, destination, git, paper, commit, sha, directory };
}

describe('academic data export', () => {
  it('exports only data blobs; historical build code is never exported or executed', () => {
    const options = fixture();
    expect(exportMemoriaSources(options)).toBe(3);
    expect(
      readFileSync(join(options.destination, 'memoria-postgrado.md'), 'utf8'),
    ).toBe('# Synthetic source');
    expect(
      readFileSync(join(options.destination, 'img', 'diagram.png')),
    ).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(existsSync(join(options.destination, 'Makefile'))).toBe(false);
    expect(existsSync(join(options.destination, 'scripts'))).toBe(false);
  });

  it('rejects a commit outside main before creating output', () => {
    const options = fixture();
    options.git('switch', '--quiet', '--create', 'unmerged');
    writeFileSync(join(options.paper, 'memoria-postgrado.md'), '# Not merged');
    const sha = options.commit();
    expect(() => exportMemoriaSources({ ...options, sha })).toThrow();
    expect(existsSync(options.destination)).toBe(false);
  });

  it('rejects symlinks without following them or creating output', () => {
    const options = fixture();
    const outside = join(options.directory, 'outside.txt');
    writeFileSync(outside, 'Unchanged');
    symlinkSync(outside, join(options.paper, 'img', 'link.png'));
    const sha = options.commit();
    options.git('update-ref', 'refs/remotes/origin/main', sha);
    expect(() => exportMemoriaSources({ ...options, sha })).toThrow(
      'Unsupported academic Git object',
    );
    expect(readFileSync(outside, 'utf8')).toBe('Unchanged');
    expect(existsSync(options.destination)).toBe(false);
  });

  it('preserves an existing destination rather than overwriting it', () => {
    const options = fixture();
    mkdirSync(options.destination);
    writeFileSync(join(options.destination, 'keep.txt'), 'Existing content');
    expect(() => exportMemoriaSources(options)).toThrow();
    expect(readFileSync(join(options.destination, 'keep.txt'), 'utf8')).toBe(
      'Existing content',
    );
  });
});
