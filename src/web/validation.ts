import { z } from 'zod';

export const enrollmentFormSchema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre completo.'),
  email: z.string().trim().email('Introduce un email válido.'),
  consent: z.literal(true, {
    error: 'Necesitamos tu consentimiento para tratar la imagen.',
  }),
});
export const imageFileSchema = z
  .custom<File>((value) => value instanceof File, 'Selecciona una imagen.')
  .refine(
    (file) => file.type.startsWith('image/'),
    'El archivo debe ser una imagen.',
  )
  .refine(
    (file) => file.size <= 10 * 1024 * 1024,
    'La imagen debe pesar menos de 10 MB.',
  );
export type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;
