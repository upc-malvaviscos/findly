import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TerraformRunner } from '../../scripts/lib/terraform-validation.mjs';
import {
  terraformRoots,
  validateTerraform,
} from '../../scripts/lib/terraform-validation.mjs';

const fixtures: string[] = [];
afterEach(() => {
  fixtures.forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'findly-validation-fixture-'));
  fixtures.push(repo);
  for (const root of terraformRoots) {
    mkdirSync(join(repo, root, '.terraform'), { recursive: true });
    writeFileSync(join(repo, root, 'main.tf'), 'terraform { backend "s3" {} }');
    writeFileSync(join(repo, root, '.terraform.lock.hcl'), 'locked-provider');
    writeFileSync(
      join(repo, root, '.terraform/backend.json'),
      'private-backend',
    );
    writeFileSync(join(repo, root, 'backend_override.tf'), 'user-override');
    writeFileSync(join(repo, root, 'terraform.tfstate'), 'private-state');
    writeFileSync(join(repo, root, 'private.tfvars'), 'private-variables');
  }
  return repo;
}
const ok = {
  status: 0,
  signal: null,
  pid: 1,
  output: [],
  stdout: '',
  stderr: '',
};

describe('isolated Terraform validation', () => {
  it('validates all roots with readonly locks and isolated data, preserving local overrides/backend/state', () => {
    const repo = fixture();
    vi.stubEnv('TF_DATA_DIR', join(repo, 'live-data'));
    const directories: string[] = [];
    const run: TerraformRunner = vi.fn((_file, args, options) => {
      const root = String(args?.[0]).slice('-chdir='.length);
      directories.push(root);
      expect(root.startsWith(repo)).toBe(false);
      expect(readFileSync(join(root, '.terraform.lock.hcl'), 'utf8')).toBe(
        'locked-provider',
      );
      expect(readFileSync(join(root, 'backend_override.tf'), 'utf8')).toContain(
        'backend "local"',
      );
      for (const path of ['.terraform', 'terraform.tfstate', 'private.tfvars'])
        expect(existsSync(join(root, path))).toBe(false);
      expect(options?.env?.TF_DATA_DIR).not.toBe(join(repo, 'live-data'));
      expect(options?.env?.TF_CLI_ARGS).toBe('');
      if (args?.[1] === 'init') expect(args).toContain('-lockfile=readonly');
      return ok;
    });
    validateTerraform({ repository: repo, run });
    expect(run).toHaveBeenCalledTimes(terraformRoots.length * 2);
    directories.forEach((path) => expect(existsSync(path)).toBe(false));
    for (const root of terraformRoots) {
      expect(
        readFileSync(join(repo, root, 'backend_override.tf'), 'utf8'),
      ).toBe('user-override');
      expect(
        readFileSync(join(repo, root, '.terraform/backend.json'), 'utf8'),
      ).toBe('private-backend');
      expect(readFileSync(join(repo, root, 'terraform.tfstate'), 'utf8')).toBe(
        'private-state',
      );
    }
  });
  it.each(['init', 'validate'])(
    'fails on %s, removes disposable files and preserves the checkout',
    (failure) => {
      const repo = fixture();
      let directory = '';
      const run: TerraformRunner = vi.fn((_file, args) => {
        directory = String(args?.[0]).slice('-chdir='.length);
        return { ...ok, status: args?.[1] === failure ? 1 : 0 };
      });
      expect(() => validateTerraform({ repository: repo, run })).toThrow(
        `terraform ${failure} failed`,
      );
      expect(existsSync(directory)).toBe(false);
      expect(
        readFileSync(
          join(repo, 'infra/bootstrap', 'backend_override.tf'),
          'utf8',
        ),
      ).toBe('user-override');
    },
  );
  it('fails if the Terraform executable cannot start', () => {
    const run: TerraformRunner = vi.fn(() => ({
      ...ok,
      status: null,
      error: new Error('ENOENT'),
    }));
    expect(() => validateTerraform({ repository: fixture(), run })).toThrow(
      'terraform init failed',
    );
  });
});
