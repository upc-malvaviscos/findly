import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const cache = join(workspace, 'provider-cache');
  mkdirSync(cache);
  const emptyAwsConfig = join(workspace, 'empty-aws-config');
  writeFileSync(emptyAwsConfig, '', { mode: 0o600 });
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('AWS_') && !name.startsWith('TF_VAR_'),
    ),
  );
  for (const moduleName of ['findly-stack', 'cognito']) {
    const moduleRoot = join(workspace, 'infra/modules', moduleName);
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
          ...environment,
          // Mocked contracts must fail if a real provider leaks into the graph,
          // even on a developer machine with authenticated AWS profiles.
          AWS_CONFIG_FILE: emptyAwsConfig,
          AWS_SHARED_CREDENTIALS_FILE: emptyAwsConfig,
          AWS_EC2_METADATA_DISABLED: 'true',
          AWS_REGION: 'eu-west-1',
          AWS_DEFAULT_REGION: 'eu-west-1',
          TF_DATA_DIR: join(workspace, 'data', moduleName),
          TF_PLUGIN_CACHE_DIR: cache,
          TF_WORKSPACE: 'default',
          TF_CLI_ARGS: '',
          TF_CLI_ARGS_init: '',
          TF_CLI_ARGS_test: '',
        },
      });
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
