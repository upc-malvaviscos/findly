import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  createEmailAcceptanceManifest,
  validateEmailAcceptanceManifest,
} from '../../scripts/lib/email-acceptance-manifest.mjs';

describe('private AWS email acceptance manifest', () => {
  it('prepares unique exact capabilities and fixture keys without recipient addresses', () => {
    const manifest = createEmailAcceptanceManifest();
    expect(manifest.fixtures).toHaveLength(10);
    expect(manifest.leadingKeys).toHaveLength(50);
    expect(new Set(manifest.leadingKeys).size).toBe(50);
    for (const fixture of manifest.fixtures)
      for (const registration of fixture.registrations) {
        expect(registration.tokenHash).toBe(
          createHash('sha256').update(registration.capability).digest('hex'),
        );
        expect(manifest.leadingKeys).toContain(
          `TOKEN#${registration.tokenHash}`,
        );
      }
    expect(JSON.stringify(manifest)).not.toContain('@gmail');
    expect(manifest.suppressionAddress).toBe(
      `success+${manifest.runId}@simulator.amazonses.com`,
    );
  });
  it('refuses arbitrary token hashes, broader partitions or foreign event IDs', () => {
    const original = createEmailAcceptanceManifest();
    const extra = structuredClone(original);
    extra.leadingKeys.push('TOKEN#*');
    expect(() => validateEmailAcceptanceManifest(extra)).toThrow(
      'Unreviewed leading keys',
    );
    const forged = structuredClone(original);
    forged.fixtures[0]!.registrations[0]!.tokenHash = 'a'.repeat(64);
    expect(() => validateEmailAcceptanceManifest(forged)).toThrow(
      'Capability hash mismatch',
    );
    const foreign = structuredClone(original);
    foreign.fixtures[0]!.eventId = 'existing-event';
    expect(() => validateEmailAcceptanceManifest(foreign)).toThrow();
  });
  it('bounds lifetime but supports inspecting an expired manifest for cleanup', () => {
    const now = Date.now();
    const manifest = createEmailAcceptanceManifest({ now });
    expect(() =>
      validateEmailAcceptanceManifest(manifest, { now: now + 7 * 3600000 }),
    ).toThrow('expired');
    expect(() =>
      validateEmailAcceptanceManifest(manifest, {
        now: now + 7 * 3600000,
        allowExpired: true,
      }),
    ).not.toThrow();
  });
  it('writes capabilities to an exclusive private file without printing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'findly-private-manifest-'));
    const destination = join(directory, 'manifest.json');
    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/prepare-email-acceptance.mjs', `--out=${destination}`],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(statSync(destination).mode & 0o777).toBe(0o600);
      const manifest = validateEmailAcceptanceManifest(
        JSON.parse(readFileSync(destination, 'utf8')),
      );
      expect(result.stdout).not.toContain(
        manifest.fixtures[0]!.registrations[0]!.capability,
      );
      expect(
        spawnSync(process.execPath, [
          'scripts/prepare-email-acceptance.mjs',
          `--out=${destination}`,
        ]).status,
      ).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
