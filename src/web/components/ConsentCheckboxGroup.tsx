import React from 'react';

type Props = {
  consentBiometrics: boolean;
  consentTerms: boolean;
  biometricsError?: string;
  termsError?: string;
  onChangeBiometrics: (checked: boolean) => void;
  onChangeTerms: (checked: boolean) => void;
};
export function ConsentCheckboxGroup({
  consentBiometrics,
  consentTerms,
  biometricsError,
  termsError,
  onChangeBiometrics,
  onChangeTerms,
}: Props) {
  return (
    <fieldset className="consent-fieldset">
      <legend>Privacidad y consentimiento</legend>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consentBiometrics}
          onChange={(event) => onChangeBiometrics(event.target.checked)}
          aria-describedby={
            biometricsError ? 'consent-biometrics-error' : undefined
          }
        />
        <span>
          Acepto el tratamiento biométrico de mi selfie para encontrar mis
          fotografías del evento.
        </span>
      </label>
      {biometricsError ? (
        <p id="consent-biometrics-error" className="field-error" role="alert">
          {biometricsError}
        </p>
      ) : null}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consentTerms}
          onChange={(event) => onChangeTerms(event.target.checked)}
          aria-describedby={termsError ? 'consent-terms-error' : 'consent-help'}
        />
        <span>
          Acepto los términos de privacidad y la política de retención de datos.
        </span>
      </label>
      <p id="consent-help" className="field-help">
        Tus imágenes se almacenarán en AWS durante un máximo de 30 días y se
        eliminarán después según nuestra política de retención. Puedes retirar
        tu consentimiento solicitándolo al organizador.
      </p>
      {termsError ? (
        <p id="consent-terms-error" className="field-error" role="alert">
          {termsError}
        </p>
      ) : null}
    </fieldset>
  );
}
