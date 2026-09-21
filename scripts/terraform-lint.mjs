import { spawnSync } from 'node:child_process';

// One tflint run per Terraform root. It is a Node script rather than an inline
// shell loop in package.json so it also runs under cmd.exe on Windows.
const roots = [
  'bootstrap',
  'environments/sandbox',
  'environments/demo',
  'environments/production',
  'ephemeral',
];

for (const root of roots) {
  const result = spawnSync('tflint', [`--chdir=infra/${root}`], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
