import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('conditional selfie upload CORS', () => {
  it('allows the signed write-once header from the configured origin only', () => {
    const source = readFileSync('infra/modules/uploads-bucket/main.tf', 'utf8');
    expect(source).toMatch(
      /allowed_headers\s*=\s*\["Content-Type", "If-None-Match"\]/,
    );
    expect(source).toMatch(/allowed_origins\s*=\s*\[var.frontend_domain_url\]/);
    expect(source).toMatch(/allowed_methods\s*=\s*\["PUT"\]/);
  });
});
