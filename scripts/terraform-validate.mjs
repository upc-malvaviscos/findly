import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

// Cada raíz declara `backend "s3" {}` parcial. Terraform 1.15 exige bucket y
// key también en `validate`, así que se sustituye temporalmente por el backend
// local con un fichero override; la configuración real no cambia.
const roots = [
  'infra/bootstrap',
  'infra/environments/sandbox',
  'infra/environments/demo',
  'infra/environments/production',
  'infra/ephemeral',
];
const overrideFile = 'backend_override.tf';

const run = (root, args) => {
  const result = spawnSync('terraform', [`-chdir=${root}`, ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0)
    throw new Error(`terraform ${args[0]} failed in ${root}.`);
};

for (const root of roots) {
  const override = `${root}/${overrideFile}`;
  try {
    writeFileSync(override, 'terraform {\n  backend "local" {}\n}\n');
    run(root, ['init', '-backend=false', '-input=false']);
    run(root, ['validate']);
  } finally {
    rmSync(override, { force: true });
  }
}
