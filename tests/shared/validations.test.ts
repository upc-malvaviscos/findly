import { describe, expect, it } from 'vitest';
import { enrollmentFormSchema } from '../../src/shared/lib/validations';

describe('enrollmentFormSchema', () => {
  it('accepts a valid submission', () => {
    const result = enrollmentFormSchema.safeParse({
      email: 'synthetic@example.com',
      consentBiometrics: true,
      consentTerms: true,
    });
    expect(result.success).toBe(true);
  });

  it.each([undefined, '', '   ', 'invalid'])(
    'rejects invalid email %s',
    (email) => {
      expect(
        enrollmentFormSchema.safeParse({
          email,
          consentBiometrics: true,
          consentTerms: true,
        }).success,
      ).toBe(false);
    },
  );

  it('rejects when consent is missing', () => {
    const result = enrollmentFormSchema.safeParse({
      consentBiometrics: false,
      consentTerms: true,
    });
    expect(result.success).toBe(false);
  });
});
