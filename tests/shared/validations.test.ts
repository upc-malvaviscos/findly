import { describe, expect, it } from 'vitest';
import { enrollmentFormSchema } from '../../src/shared/lib/validations';

describe('enrollmentFormSchema', () => {
  it('accepts a valid submission', () => {
    const result = enrollmentFormSchema.safeParse({
      consentBiometrics: true,
      consentTerms: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when consent is missing', () => {
    const result = enrollmentFormSchema.safeParse({
      consentBiometrics: false,
      consentTerms: true,
    });
    expect(result.success).toBe(false);
  });
});
