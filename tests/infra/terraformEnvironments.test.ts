import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const infra = join(process.cwd(), 'infra');
const read = (path: string): string => readFileSync(join(infra, path), 'utf8');
const environments = ['sandbox', 'demo', 'production'] as const;

describe.each(environments)('environment root %s', (environment) => {
  const main = read(`environments/${environment}/main.tf`);
  const tfvars = read(`environments/${environment}/terraform.tfvars`);

  it('pins its own environment and a partial S3 backend', () => {
    expect(main).toContain(`environment = "${environment}"`);
    expect(main).toContain(`findly/${environment}/terraform.tfstate`);
    expect(main).toMatch(/backend "s3" \{\}/);
  });

  it('does not let tfvars retarget the environment', () => {
    expect(tfvars).not.toMatch(/^\s*environment\s*=/m);
    expect(read(`environments/${environment}/variables.tf`)).not.toContain(
      'variable "environment"',
    );
  });

  it('tags every resource through default_tags', () => {
    for (const tag of [
      'Project',
      'Environment',
      'ManagedBy',
      'CostCenter',
      'DataClass',
    ])
      expect(main).toMatch(new RegExp(`${tag}\\s+=`));
  });

  it('keeps tfvars free of secrets', () => {
    const assignments = tfvars.replace(/^\s*#.*$/gm, '');
    expect(assignments).not.toMatch(
      /(secret|password|token|access_key|AKIA[0-9A-Z]{16})/i,
    );
  });

  it('only allows bucket destruction in sandbox', () => {
    const expected = environment === 'sandbox' ? 'true' : 'false';
    expect(main).toContain(`allow_bucket_destroy = ${expected}`);
  });
});

describe('isolation between environments', () => {
  it('uses a distinct state key per environment', () => {
    const keys = environments.map(
      (environment) =>
        /findly\/[a-z]+\/terraform\.tfstate/.exec(
          read(`environments/${environment}/main.tf`),
        )?.[0],
    );
    expect(new Set(keys).size).toBe(environments.length);
  });

  it('defaults bucket destruction to false in the shared stack module', () => {
    expect(read('modules/findly-stack/variables.tf')).toMatch(
      /variable "allow_bucket_destroy"[\s\S]*?default\s+=\s+false/,
    );
  });
});

describe('state bucket bootstrap', () => {
  const bootstrap = read('bootstrap/main.tf');

  it.each([
    ['prevent_destroy', 'prevent_destroy = true'],
    ['versioning', 'status = "Enabled"'],
    ['SSE-S3', 'sse_algorithm = "AES256"'],
    ['public access block', 'block_public_acls       = true'],
    ['TLS-only policy', 'aws:SecureTransport'],
  ])('enforces %s', (_name, snippet) => {
    expect(bootstrap).toContain(snippet);
  });
});
