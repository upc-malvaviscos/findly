import React, { useState } from 'react';
import { useAuth } from '../../context/auth';

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  return (
    <main className="page-shell">
      <section
        className="enrollment-card auth-card"
        aria-labelledby="login-title"
      >
        <span className="eyebrow">Área de organizadores</span>
        <h1 id="login-title">Iniciar sesión.</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setIsLoading(true);
            setError('');
            void login(username, password)
              .then(onSuccess)
              .catch(() =>
                setError('El usuario o la contraseña no son válidos.'),
              )
              .finally(() => setIsLoading(false));
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
