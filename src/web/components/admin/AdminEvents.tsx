import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/auth';
import { BulkPhotoUploader } from './BulkPhotoUploader';
import { createAdminEvent, getAdminEvents } from '../../adminApi';
import type { AdminEvent } from '../../../shared/types/api';

export function AdminEvents({ onLogout }: { onLogout: () => void }) {
  const { logout, session } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    void getAdminEvents(session.idToken)
      .then(({ events: nextEvents }) => {
        setEvents(nextEvents);
        setSelectedEventId(
          (current) => current || nextEvents[0]?.eventId || '',
        );
      })
      .catch(() => setError('No se pudieron cargar los eventos.'))
      .finally(() => setLoading(false));
  }, [session]);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setError('');
    try {
      const created = await createAdminEvent(session.idToken, {
        name,
        date: new Date(date).toISOString(),
        retentionDays,
      });
      const next = await getAdminEvents(session.idToken);
      setEvents(next.events);
      setSelectedEventId(created.eventId);
      setName('');
      setDate('');
    } catch {
      setError(
        'No se pudo crear el evento. Revisa los datos e inténtalo de nuevo.',
      );
    }
  }
  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="brand">
          <span className="brand-mark">/</span> Findly
        </div>
        <button
          className="button button-quiet"
          onClick={() => {
            logout();
            onLogout();
          }}
        >
          Cerrar sesión
        </button>
      </header>
      <section
        className="enrollment-card admin-card"
        aria-labelledby="events-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">Administración</span>
            <h2 id="events-title">Tus eventos</h2>
          </div>
        </div>
        {loading ? <p>Cargando eventos…</p> : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <form
          onSubmit={(event) => void onCreate(event)}
          className="admin-event-form"
        >
          <label className="field">
            <span>Nombre del evento</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Fecha</span>
            <input
              type="datetime-local"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Retención (días)</span>
            <input
              type="number"
              min="1"
              max="365"
              value={retentionDays}
              onChange={(event) => setRetentionDays(Number(event.target.value))}
              required
            />
          </label>
          <button className="button button-primary" type="submit">
            Crear evento
          </button>
        </form>
        {events.length > 0 ? (
          <label className="field">
            <span>Evento seleccionado</span>
            <select
              value={selectedEventId}
              onChange={(event) => setSelectedEventId(event.target.value)}
            >
              {events.map((event) => (
                <option key={event.eventId} value={event.eventId}>
                  {event.name} ·{' '}
                  {new Date(event.date).toLocaleDateString('es-ES')}
                </option>
              ))}
            </select>
          </label>
        ) : !loading ? (
          <p>No hay eventos todavía. Crea el primero para subir fotografías.</p>
        ) : null}
        {selectedEventId ? (
          <BulkPhotoUploader
            eventId={selectedEventId}
            token={session?.idToken ?? ''}
          />
        ) : null}
      </section>
    </main>
  );
}
