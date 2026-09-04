import React from 'react';

type Props = {
  checked: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
};
export function ConsentCheckboxGroup({ checked, error, onChange }: Props) {
  return (
    <fieldset
      className="consent-fieldset"
      aria-describedby={error ? 'consent-error' : 'consent-help'}
    >
      <legend>Privacidad y consentimiento</legend>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Acepto el tratamiento de mi imagen para encontrar mis fotografías y
          recibir el enlace a mi galería privada.
        </span>
      </label>
      <p id="consent-help" className="field-help">
        Tus imágenes se almacenarán en AWS durante un máximo de 30 días y se
        eliminarán después según nuestra política de retención. Puedes retirar
        tu consentimiento solicitándolo al organizador.
      </p>
      {error ? (
        <p id="consent-error" className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
