import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const prohibitedPath = /(^|\/)(\.env(?:\..+)?|[^/]+\.tfstate(?:\..+)?)$/u;
const awsAccessKey = /AKIA[0-9A-Z]{16}/u;
const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const failures = trackedFiles.filter(
  (file) => file !== '.env.example' && prohibitedPath.test(file),
);

for (const file of trackedFiles) {
  const content = readFileSync(file, 'utf8');

  if (awsAccessKey.test(content)) {
    failures.push(`${file} contains an AWS access key identifier`);
  }
}

if (failures.length > 0) {
  throw new Error(`Tracked secret policy violations:\n${failures.join('\n')}`);
}
