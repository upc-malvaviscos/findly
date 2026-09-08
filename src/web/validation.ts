import { z } from 'zod';

export {
  enrollmentFormSchema,
  type EnrollmentFormValues,
} from '../shared/lib/validations';

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
