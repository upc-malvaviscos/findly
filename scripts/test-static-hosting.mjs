import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Los proveedores mock de Terraform prueban planes sin credenciales ni AWS.
// La copia aislada conserva los locks y no toca backends/estados del checkout.
const workspace = mkdtempSync(join(tmpdir(), 'findly-hosting-test-'));
const cache = join(workspace, 'provider-cache');
mkdirSync(cache);
const run = (root, args) => {
  const result = spawnSync('terraform', [`-chdir=${root}`, ...args], {
    stdio: 'inherit',
    env: { ...process.env, TF_PLUGIN_CACHE_DIR: cache },
  });
  if (result.status !== 0) throw new Error(`Hosting test failed: ${args[0]}`);
};
try {
  cpSync('infra', join(workspace, 'infra'), {
    recursive: true,
    filter: (source) =>
      !source.split(/[\\/]/).includes('.terraform') &&
      !source.endsWith('_override.tf') &&
      !/\.tfstate(?:\.|$)/.test(source),
  });
  cpSync('artifacts', join(workspace, 'artifacts'), { recursive: true });
  const demo = join(workspace, 'infra/environments/demo');
  const hosting = join(workspace, 'infra/modules/cloudfront');
  const providers = 'infra/environments/demo/.terraform/providers';
  if (existsSync(providers)) {
    cpSync(providers, cache, { recursive: true, dereference: true });
  }
  writeFileSync(
    join(demo, 'backend_override.tf'),
    'terraform {\n  backend "local" {}\n}\n',
  );
  cpSync(
    join(demo, '.terraform.lock.hcl'),
    join(hosting, '.terraform.lock.hcl'),
  );
  for (const root of [demo, hosting]) {
    run(root, ['init', '-backend=false', '-input=false', '-lockfile=readonly']);
    run(root, ['test', '-no-color']);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
