import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prefix = 'docs/paper/memoria-findly/';

export function exportMemoriaSources({ repository, destination, sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source commit.');
  const git = (...args) =>
    execFileSync('git', ['-C', repository, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('merge-base', '--is-ancestor', sha, 'origin/main');
  const entries = git(
    'ls-tree',
    '-r',
    '-z',
    sha,
    '--',
    `${prefix}memoria-postgrado.md`,
    `${prefix}portada.tex`,
    `${prefix}img`,
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match)
        throw new Error(
          'Unsupported academic Git object (symlinks and submodules are rejected).',
        );
      const path = match[3];
      if (!path.startsWith(prefix))
        throw new Error('Academic path outside the allowlist.');
      const relative = path.slice(prefix.length);
      if (
        isAbsolute(relative) ||
        relative.includes('\\') ||
        relative
          .split('/')
          .some((part) => !part || part === '.' || part === '..')
      )
        throw new Error('Unsafe academic path.');
      return { blob: match[2], path: relative };
    });
  for (const required of ['memoria-postgrado.md', 'portada.tex']) {
    if (!entries.some((entry) => entry.path === required))
      throw new Error(`Missing ${required}`);
  }
  // Export bytes only. Never checkout/run a historical Makefile, script,
  // submodule, symlink or package hook in the privileged publication job.
  mkdirSync(destination);
  for (const entry of entries) {
    let content;
    try {
      content = git('cat-file', 'blob', entry.blob);
    } catch {
      throw new Error(`Unable to read academic blob: ${entry.path}`);
    }
    const target = resolve(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx', mode: 0o644 });
  }
  return entries.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [repository, destination] = process.argv.slice(2);
  const count = exportMemoriaSources({
    repository,
    destination,
    sha: process.env.SOURCE_SHA,
  });
  console.log(
    `Exported ${count} academic data blobs from a verified main commit.`,
  );
}
