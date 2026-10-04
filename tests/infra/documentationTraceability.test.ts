import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTraceability } from '../../scripts/lib/documentation-traceability.mjs';

const fixtures: string[] = [];
afterEach(() =>
  fixtures.forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'findly-traceability-'));
  fixtures.push(repo);
  const requirement = {
    id: 'REQ-EXAMPLE',
    description: 'Example contract',
    issues: [2],
    spec: 'specs/example.md',
    implementation: ['implementation.mjs'],
    verification: [
      { command: 'test', environment: 'unit', files: ['test.ts'] },
    ],
    evidence: [{ file: 'evidence.md', environment: 'unit' }],
    documentation: ['README.md'],
  };
  mkdirSync(join(repo, 'specs'));
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } }),
  );
  for (const file of [
    'specs/example.md',
    'implementation.mjs',
    'test.ts',
    'evidence.md',
    'README.md',
  ])
    writeFileSync(
      join(repo, file),
      '<!-- requirement: REQ-EXAMPLE -->\nOriginal prose and historical run 36482560393.',
    );
  writeFileSync(
    join(repo, 'specs/example.md'),
    '<!-- requirement: REQ-EXAMPLE -->\n[#2](https://github.com/upc-malvaviscos/findly/issues/2) [evidence](../evidence.md)',
  );
  return {
    repo,
    manifest: { version: 1, requirements: [requirement] },
    requirement,
  };
}
describe('structured documentation traceability', () => {
  it('checks the committed registry without depending on historical phrases or run numbers', () => {
    const manifest = JSON.parse(readFileSync('docs/traceability.json', 'utf8'));
    expect(() => checkTraceability(process.cwd(), manifest)).not.toThrow();
    const { repo, manifest: example } = fixture();
    writeFileSync(
      join(repo, 'README.md'),
      'Completely rewritten current documentation.',
    );
    expect(checkTraceability(repo, example)).toBe(1);
  });
  it.each(['implementation.mjs', 'test.ts', 'evidence.md', 'specs/example.md'])(
    'fails if %s disappears even when historical prose remains',
    (file) => {
      const { repo, manifest } = fixture();
      rmSync(join(repo, file));
      expect(() => checkTraceability(repo, manifest)).toThrow(
        'missing or unsafe file',
      );
    },
  );
  it('rejects an orphaned spec/evidence declaration, duplicate requirement and unknown npm script', () => {
    const { repo, manifest, requirement } = fixture();
    writeFileSync(join(repo, 'evidence.md'), '<!-- requirement: REQ-OTHER -->');
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'missing requirement declaration',
    );
    writeFileSync(
      join(repo, 'evidence.md'),
      '<!-- requirement: REQ-EXAMPLE -->',
    );
    manifest.requirements.push(requirement);
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'Duplicate requirement',
    );
    manifest.requirements.pop();
    const verification = requirement.verification.at(0);
    if (!verification) throw new Error('Missing fixture verification');
    verification.command = 'nonexistent';
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'unknown npm script',
    );
  });
  it('rejects unsupported schemas and does not treat a mock document as AWS evidence', () => {
    const { repo, manifest, requirement } = fixture();
    expect(() =>
      checkTraceability(repo, { ...manifest, version: 2 }),
    ).toThrow();
    const verification = requirement.verification.at(0);
    if (!verification) throw new Error('Missing fixture verification');
    verification.environment = 'aws';
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'no evidence reference for aws',
    );
  });
  it('fails when a registry entry is removed while its spec still declares the requirement', () => {
    const manifest = JSON.parse(readFileSync('docs/traceability.json', 'utf8'));
    manifest.requirements.pop();
    expect(() => checkTraceability(process.cwd(), manifest)).toThrow(
      'Orphaned requirement',
    );
  });
  it('rejects incorrect issue and evidence relationships even when all files exist', () => {
    const { repo, manifest, requirement } = fixture();
    requirement.issues = [999];
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'spec does not link issue #999',
    );
    requirement.issues = [2];
    writeFileSync(
      join(repo, 'specs/example.md'),
      '<!-- requirement: REQ-EXAMPLE -->\n[#2](https://github.com/upc-malvaviscos/findly/issues/2)',
    );
    expect(() => checkTraceability(repo, manifest)).toThrow(
      'spec does not link evidence',
    );
  });
  it('rejects escaped paths and symlinks outside the repository', () => {
    const { repo, manifest, requirement } = fixture();
    requirement.implementation[0] = '../outside';
    expect(() => checkTraceability(repo, manifest)).toThrow('unsafe file');
    requirement.implementation[0] = 'implementation.mjs';
    rmSync(join(repo, 'implementation.mjs'));
    const external = mkdtempSync(join(tmpdir(), 'findly-external-fixture-'));
    fixtures.push(external);
    writeFileSync(join(external, 'outside'), 'existing external file');
    symlinkSync(join(external, 'outside'), join(repo, 'implementation.mjs'));
    expect(() => checkTraceability(repo, manifest)).toThrow('unsafe file');
  });
});
