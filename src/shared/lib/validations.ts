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

export const createAdminEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: z.string().datetime({ offset: true }),
  retentionDays: z.number().int().min(1).max(365),
});

export const photoUploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        contentType: z.literal('image/jpeg'),
      }),
    )
    .min(1)
    .max(50),
});
