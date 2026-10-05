import React, { useState } from 'react';
import { useAuth } from '../../context/auth';

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const { login, newPasswordChallenge, challengeExpired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (newPasswordChallenge) return <NewPasswordForm onSuccess={onSuccess} />;

  return (
    <main className="page-shell">
      <section
        className="enrollment-card auth-card"
        aria-labelledby="login-title"
      >
        <span className="eyebrow">Área de organizadores</span>
        <h1 id="login-title">Iniciar sesión.</h1>
        {challengeExpired && (
          <p className="field-error" role="alert">
            La sesión ha caducado. Vuelve a entrar con tu contraseña temporal.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setIsLoading(true);
            setError('');
            void login(username, password)
              .then((result) => {
                if (result === 'authenticated') onSuccess();
              })
              .catch(() =>
                setError('El usuario o la contraseña no son válidos.'),
              )
              .finally(() => {
                setPassword('');
                setIsLoading(false);
              });
          }}
        >
          <label className="field">
            <span>Usuario</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary button-submit"
            disabled={isLoading}
          >
            {isLoading ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function NewPasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const { completeNewPassword, cancelNewPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  return (
    <main className="page-shell">
      <section
        className="enrollment-card auth-card"
        aria-labelledby="new-password-title"
      >
        <span className="eyebrow">Activa tu acceso de organizador</span>
        <h1 id="new-password-title">Elige tu contraseña.</h1>
        <p id="password-help">
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
              setError('La contraseña debe cumplir los requisitos indicados.');
              return;
            }
            setIsLoading(true);
            void completeNewPassword(password)
              .then(onSuccess)
              .catch(() =>
                setError(
                  'No hemos podido guardar la contraseña. Comprueba los requisitos y vuelve a intentarlo.',
                ),
              )
              .finally(() => {
                setPassword('');
                setConfirmation('');
                setIsLoading(false);
              });
          }}
        >
          <label className="field">
            <span>Nueva contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              aria-describedby="password-help"
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
            disabled={isLoading}
          >
            {isLoading ? 'Guardando…' : 'Guardar y entrar'}
          </button>
          <button className="button" type="button" onClick={cancelNewPassword}>
            Volver al inicio de sesión
          </button>
        </form>
      </section>
    </main>
  );
}
