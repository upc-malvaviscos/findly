import React, { useEffect, useState } from 'react';
import { getEvent, getEvents } from './api';
import { AdminEvents } from './components/admin/AdminEvents';
import { AdminLogin } from './components/admin/AdminLogin';
import { SelfieCaptureForm } from './components/SelfieCaptureForm';
import { AuthProvider } from './context/AuthProvider';
import type { AuthGateway } from './context/AuthProvider';
import { useAuth } from './context/auth';
import type { Event } from './types';
import { GalleryPage } from './components/gallery/GalleryPage';
import './styles.css';

function PublicEnrollment() {
  const [event, setEvent] = useState<Event | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const eventId = new URLSearchParams(window.location.search).get('event');
    const load = async () => {
      try {
        if (eventId) {
          const found = await getEvent(eventId);
          if (active) {
            setEvent(found);
            setEvents(found ? [found] : []);
          }
        } else {
          const found = await getEvents();
          if (active) {
            setEvents(found);
            setEvent(found[0] ?? null);
          }
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);
  if (loading)
    return (
      <main className="page-shell" aria-busy="true">
        Cargando eventos…
      </main>
    );
  if (loadError)
    return (
      <main className="page-shell" role="alert">
        No hemos podido cargar los eventos. Inténtalo de nuevo.
      </main>
    );
  if (!event)
    return (
      <main className="page-shell">
        No hay eventos disponibles para inscribirse.
      </main>
    );
  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="brand">
          <span className="brand-mark">/</span> Findly
        </div>
        <span className="header-note">Tus recuerdos, encontrados.</span>
      </header>
      <div className="content-grid">
        <section className="editorial-panel" aria-labelledby="page-title">
          <span className="eyebrow">{event.location}</span>
          <h1 id="page-title">Encuentra tu momento.</h1>
          <div className="event-meta">
            <strong>{event.name}</strong>
            <span>
              {new Intl.DateTimeFormat('es-ES', {
                dateStyle: 'full',
                timeStyle: 'short',
              }).format(new Date(event.date))}
            </span>
          </div>
          <p className="editorial-copy">{event.description}</p>
          <p className="privacy-note">
            <strong>Tu privacidad primero.</strong>
            <br />
            Solo usamos tu selfie para encontrar tus fotos del evento. No
            vendemos tus datos ni los usamos para otros fines.
          </p>
        </section>
        <section
          className="enrollment-card"
          aria-label="Formulario de inscripción"
        >
          {events.length > 1 ? (
            <label>
              Evento
              <select
                value={event.eventId}
                onChange={(change) =>
                  setEvent(
                    events.find(
                      (item) => item.eventId === change.target.value,
                    ) ?? null,
                  )
                }
              >
                {events.map((item) => (
                  <option key={item.eventId} value={item.eventId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SelfieCaptureForm key={event.eventId} eventId={event.eventId} />
        </section>
      </div>
    </main>
  );
}

function RoutedApp() {
  const { isAuthenticated, newPasswordChallenge } = useAuth();
  const needsNewPassword = Boolean(newPasswordChallenge);
  const [locationPath, setPath] = useState(window.location.pathname);
  const path = locationPath === '/admin' ? '/admin/login' : locationPath;
  useEffect(() => {
    let title = 'Encuentra tus fotos';
    if (path === '/gallery') title = 'Tu galería';
    else if (path === '/admin/login' || path === '/admin/events') {
      if (isAuthenticated) title = 'Eventos';
      else title = needsNewPassword ? 'Elige tu contraseña' : 'Iniciar sesión';
    }
    document.title = `${title} · Findly`;
  }, [path, isAuthenticated, needsNewPassword]);
  const navigate = (nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  };
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (locationPath === '/admin')
      window.history.replaceState({}, '', '/admin/login');
  }, [locationPath]);
  if (path === '/admin/login')
    return isAuthenticated ? (
      <AdminEvents onLogout={() => navigate('/admin/login')} />
    ) : (
      <AdminLogin onSuccess={() => navigate('/admin/events')} />
    );
  if (path === '/admin/events')
    return isAuthenticated ? (
      <AdminEvents onLogout={() => navigate('/admin/login')} />
    ) : (
      <AdminLogin onSuccess={() => navigate('/admin/events')} />
    );
  if (path === '/gallery')
    return (
      <GalleryPage
        token={new URLSearchParams(window.location.search).get('token') ?? ''}
      />
    );
  return <PublicEnrollment />;
}

export function App({ authGateway }: { authGateway?: AuthGateway } = {}) {
  return (
    <AuthProvider gateway={authGateway}>
      <RoutedApp />
    </AuthProvider>
  );
}
