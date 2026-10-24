import React, { useState } from 'react';
import { useAuth } from '../../context/auth';

export function PasswordRecoveryForm({ onBack }: { onBack: () => void }) {
  const { completePasswordRecovery, cancelNewPassword } = useAuth();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const back = () => {
    cancelNewPassword();
    onBack();
  };
  return (
    <main className="page-shell">
      <section
        className="enrollment-card auth-card"
        aria-labelledby="recovery-title"
      >
        <span className="eyebrow">Área de organizadores</span>
        <h1 id="recovery-title">Recuperar acceso.</h1>
        {done ? (
          <p role="status">
            Contraseña actualizada. Vuelve a iniciar sesión con tu nueva
            contraseña.
          </p>
        ) : (
          <>
            <p>
              Introduce el código recibido por correo tras ejecutar «Recuperar
              mi acceso a Findly» en GitHub Actions. Si recibiste una contraseña
              temporal, vuelve al inicio de sesión.
            </p>
            <p id="recovery-password-help">
              Usa al menos 12 caracteres, con mayúsculas, minúsculas, números y
              símbolos.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                if (password !== confirmation) {
                  setError('Las contraseñas no coinciden.');
                  return;
                }
                if (
                  password.length < 12 ||
                  password.length > 256 ||
                  !/[A-Z]/.test(password) ||
                  !/[a-z]/.test(password) ||
                  !/[0-9]/.test(password) ||
                  !/[^A-Za-z0-9\s]/.test(password)
                ) {
                  setError(
                    'La contraseña debe cumplir los requisitos indicados.',
                  );
                  return;
                }
                setBusy(true);
                void completePasswordRecovery(username, code, password)
                  .then(() => setDone(true))
                  .catch(() =>
                    setError(
                      'No hemos podido cambiar la contraseña. Comprueba el usuario, el código y los requisitos de contraseña. Si el código ha caducado, solicita otro desde la acción.',
                    ),
                  )
                  .finally(() => {
                    setCode('');
                    setPassword('');
                    setConfirmation('');
                    setBusy(false);
                  });
              }}
            >
              <label className="field">
                <span>Usuario</span>
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  maxLength={128}
                />
              </label>
              <label className="field">
                <span>Código de recuperación</span>
                <input
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  maxLength={2048}
                />
              </label>
              <label className="field">
                <span>Nueva contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="recovery-password-help"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={256}
                />
              </label>
              <label className="field">
                <span>Repite la contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  maxLength={256}
                />
              </label>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button button-primary button-submit"
                disabled={busy}
              >
                {busy ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          </>
        )}
        <button className="button" type="button" onClick={back}>
          Volver al inicio de sesión
        </button>
      </section>
    </main>
  );
}
