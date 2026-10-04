import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const terraformRoots = [
  'infra/bootstrap',
  'infra/email-identity',
  'infra/environments/sandbox',
  'infra/environments/demo',
  'infra/environments/production',
  'infra/ephemeral',
];

export function validateTerraform({
  repository = process.cwd(),
  run = spawnSync,
} = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'findly-validate-'));
  try {
    cpSync(join(repository, 'infra'), join(workspace, 'infra'), {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return (
          !source.split(/[\\/]/).includes('.terraform') &&
          !/\.tfstate(?:\.|$)|\.tfvars(?:\.json)?$/.test(name) &&
          !/^(?:override\.tf(?:\.json)?|.*_override\.tf(?:\.json)?)$/.test(name)
        );
      },
    });
    const cache = join(workspace, 'provider-cache');
    mkdirSync(cache);
    for (const root of terraformRoots) {
      const directory = join(workspace, root);
      // Partial S3 backends are replaced only in this disposable configuration.
      // The checkout, its overrides and initialized backend are never modified.
      writeFileSync(
        join(directory, 'backend_override.tf'),
        'terraform {\n  backend "local" {}\n}\n',
      );
      const env = {
        ...process.env,
        TF_DATA_DIR: join(workspace, 'data', root),
        TF_PLUGIN_CACHE_DIR: cache,
        TF_WORKSPACE: 'default',
        TF_CLI_ARGS: '',
        TF_CLI_ARGS_init: '',
        TF_CLI_ARGS_validate: '',
      };
      for (const args of [
        ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
        ['validate'],
      ]) {
        const result = run('terraform', [`-chdir=${directory}`, ...args], {
          env,
          stdio: 'inherit',
        });
        if (result.error || result.status !== 0)
          throw new Error(`terraform ${args[0]} failed in ${root}.`);
      }
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
