import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'findly-email-infra-'));
try {
  cpSync('infra/modules/gallery-email', workspace, { recursive: true });
  cpSync(
    'infra/email-identity/.terraform.lock.hcl',
    join(workspace, '.terraform.lock.hcl'),
  );
  for (const args of [
    ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
    ['test', '-no-color'],
  ]) {
    execFileSync('terraform', [`-chdir=${workspace}`, ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        TF_DATA_DIR: join(workspace, '.terraform'),
        TF_WORKSPACE: 'default',
        TF_CLI_ARGS: '',
        TF_CLI_ARGS_init: '',
        TF_CLI_ARGS_test: '',
      },
    });
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
