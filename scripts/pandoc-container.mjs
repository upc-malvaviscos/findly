import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const paper =
  process.env.FINDLY_PAPER_SOURCE_DIRECTORY ??
  fileURLToPath(new URL('../docs/paper/memoria-findly/', import.meta.url));
const { image, platform } = JSON.parse(
  readFileSync(
    new URL('../docs/paper/memoria-findly/pdf-toolchain.json', import.meta.url),
    'utf8',
  ),
);
// Mount only the academic sources. The converter needs neither network nor secrets.
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--platform',
    platform,
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--env',
    'HOME=/tmp',
    '--volume',
    `${paper}:/data`,
    '--workdir',
    '/data',
    image,
    ...process.argv.slice(2),
  ],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
// External filters write warnings directly to stderr; Pandoc's flag alone
// does not reliably promote those diagnostics to a failed conversion.
const filterWarning =
  /\bWARNING\b|Reference not found|Missing character:/i.test(
    result.stderr ?? '',
  );
process.exitCode = result.status === 0 && !filterWarning ? 0 : 1;
