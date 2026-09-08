import React, { useState } from 'react';
import {
  createRegistration,
  getRegistrationStatus,
  uploadFileToS3,
} from '../api';
import type { RegistrationStatus } from '../types';
import {
  enrollmentFormSchema,
  imageFileSchema,
  type EnrollmentFormValues,
} from '../validation';
import { CameraModal } from './CameraModal';
import { ConsentCheckboxGroup } from './ConsentCheckboxGroup';
import { FileDropzone } from './FileDropzone';
import { UploadProgressBar } from './UploadProgressBar';

type Props = { eventId: string };
type FieldErrors = Partial<Record<keyof EnrollmentFormValues | 'file', string>>;

function describeStatus(
  status: RegistrationStatus,
  failureReason?: string,
): string {
  switch (status) {
    case 'UPLOAD_PENDING':
      return 'Preparando tu registro…';
    case 'PROCESSING':
      return 'Estamos comprobando tu selfie. Esto tardará solo unos instantes.';
    case 'ENROLLED':
      return 'Tu selfie está lista. Te enviaremos el enlace a tu galería privada por email.';
    case 'FAILED':
      return (
        failureReason ??
        'No hemos podido validar tu selfie. Inténtalo de nuevo.'
      );
  }
}

export function SelfieCaptureForm({ eventId }: Props) {
  const [values, setValues] = useState({
    email: '',
    consentBiometrics: false,
    consentTerms: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<RegistrationStatus | 'IDLE'>('IDLE');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const handleFile = (nextFile: File | null) => {
    setFile(nextFile);
    setErrors((current) => ({ ...current, file: undefined }));
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    const email = values.email.trim();
    const parsed = enrollmentFormSchema.safeParse({
      email: email === '' ? undefined : email,
      consentBiometrics: values.consentBiometrics,
      consentTerms: values.consentTerms,
    });
    if (!parsed.success)
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof EnrollmentFormValues;
        if (!nextErrors[field]) nextErrors[field] = issue.message;
      });
    const parsedFile = imageFileSchema.safeParse(file);
    if (!parsedFile.success)
      nextErrors.file =
        parsedFile.error.issues[0]?.message ?? 'Selecciona una imagen.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setStatus('FAILED');
      setMessage('Revisa los campos marcados antes de continuar.');
      return;
    }
    setStatus('UPLOAD_PENDING');
    setMessage(describeStatus('UPLOAD_PENDING'));
    setProgress(0);
    try {
      const registration = await createRegistration(eventId, {
        email: email === '' ? undefined : email,
        consentBiometrics: true,
        consentTerms: true,
      });
      setStatus('PROCESSING');
      setMessage('Registro creado. Subiendo tu selfie…');
      await uploadFileToS3(
        registration.uploadUrl,
        file as File,
        ({ percentage }) => setProgress(percentage),
      );
      setMessage(describeStatus('PROCESSING'));
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await getRegistrationStatus(registration.registrationId);
        setStatus(result.status);
        setMessage(describeStatus(result.status, result.failureReason));
        if (result.status === 'ENROLLED' || result.status === 'FAILED') break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
    } catch {
      setStatus('FAILED');
      setMessage(
        'No hemos podido completar la subida. Comprueba tu conexión e inténtalo de nuevo.',
      );
    }
  };
  const isBusy = status === 'UPLOAD_PENDING' || status === 'PROCESSING';
  return (
    <>
      <form
        className="enrollment-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">01 · Tus datos</span>
            <h2>Te encontraremos en el recuerdo</h2>
          </div>
          <span className="required-mark">Privado</span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Email para tu galería (opcional)</span>
            <input
              type="email"
              value={values.email}
              onChange={(event) =>
                setValues({ ...values, email: event.target.value })
              }
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              autoComplete="email"
              inputMode="email"
            />
            {errors.email ? (
              <small id="email-error" className="field-error" role="alert">
                {errors.email}
              </small>
            ) : null}
          </label>
        </div>
        <FileDropzone
          file={file}
          error={errors.file}
          onFileSelected={handleFile}
          onOpenCamera={() => setCameraOpen(true)}
        />
        <ConsentCheckboxGroup
          consentBiometrics={values.consentBiometrics}
          consentTerms={values.consentTerms}
          biometricsError={errors.consentBiometrics}
          termsError={errors.consentTerms}
          onChangeBiometrics={(consentBiometrics) =>
            setValues({ ...values, consentBiometrics })
          }
          onChangeTerms={(consentTerms) =>
            setValues({ ...values, consentTerms })
          }
        />
        {status !== 'IDLE' ? (
          <div
            className={`status-panel status-${status.toLowerCase()}`}
            role="status"
            aria-live="polite"
          >
            <strong>
              {status === 'ENROLLED'
                ? 'Registro completado'
                : status === 'FAILED'
                  ? 'Necesitamos que lo revises'
                  : 'Estamos en ello'}
            </strong>
            <span>{message}</span>
            {progress > 0 && isBusy ? (
              <UploadProgressBar percentage={progress} />
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          className="button button-primary button-submit"
          disabled={isBusy}
        >
          {isBusy ? 'Procesando…' : 'Enviar mi selfie'}
        </button>
      </form>
      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(captured) => {
          handleFile(captured);
          setCameraOpen(false);
        }}
      />
    </>
  );
}
