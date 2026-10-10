import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'findly-stack-infra-'));
try {
  // findly-stack references sibling modules (../dynamodb, ../cognito, ...)
  // and lambda artifacts via a path.module-relative "../../../artifacts/..."
  // hardcoded three levels up, matching infra/modules/findly-stack in the
  // real repo. The copy preserves that exact depth so both resolve.
  cpSync('infra/modules', join(workspace, 'infra/modules'), {
    recursive: true,
  });
  cpSync('artifacts', join(workspace, 'artifacts'), { recursive: true });
  const moduleRoot = join(workspace, 'infra/modules/findly-stack');
  cpSync(
    'infra/environments/demo/.terraform.lock.hcl',
    join(moduleRoot, '.terraform.lock.hcl'),
  );
  for (const args of [
    ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
    ['test', '-no-color'],
  ]) {
    execFileSync('terraform', [`-chdir=${moduleRoot}`, ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        // The full stack (unlike the narrower cloudfront/gallery-email
        // module tests) needs a resolvable region to configure the mocked
        // aws provider; set a placeholder so this doesn't depend on an
        // ambient AWS profile/config being present on the machine running it.
        AWS_REGION: 'eu-west-1',
        AWS_DEFAULT_REGION: 'eu-west-1',
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
