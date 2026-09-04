import { execFileSync } from 'node:child_process';

export default function globalTeardown() {
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.yml',
      'down',
      '--volumes',
      '--remove-orphans',
    ],
    { stdio: 'inherit' },
  );
}
