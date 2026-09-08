import { z } from 'zod';

export const enrollmentFormSchema = z.object({
  email: z.string().trim().email('Introduce un email válido.').optional(),
  consentBiometrics: z.literal(true, {
    error: 'Necesitamos tu consentimiento para tratar tu imagen.',
  }),
  consentTerms: z.literal(true, {
    error: 'Acepta los términos de privacidad para continuar.',
  }),
});

export type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;
