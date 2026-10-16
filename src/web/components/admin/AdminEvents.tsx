import { GalleryEmailSender } from './GalleryEmailSender';
import { EventPhotoManager } from './EventPhotoManager';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/auth';
import { BulkPhotoUploader } from './BulkPhotoUploader';
import {
  createAdminEvent,
  deleteAdminEvent,
  getAdminEvents,
  updateAdminEvent,
} from '../../adminApi';
import type { AdminEvent } from '../../../shared/types/api';

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

export function AdminEvents({ onLogout }: { onLogout: () => void }) {
  const { logout, session } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const selectedEvent = events.find(
    (event) => event.eventId === selectedEventId,
  );
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editRetentionDays, setEditRetentionDays] = useState(30);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // Resets the edit form from the newly selected event during render
  // (React's documented "adjusting state when a prop changes" pattern),
  // not in an effect: the guard converges in the same render instead of
  // cascading one.
  const [syncedEventId, setSyncedEventId] = useState<string | null>(null);
  if (selectedEvent && syncedEventId !== selectedEvent.eventId) {
    setSyncedEventId(selectedEvent.eventId);
    setEditName(selectedEvent.name);
    setEditDate(toDatetimeLocal(selectedEvent.date));
    setEditRetentionDays(selectedEvent.retentionDays);
    setEditError('');
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  async function onSaveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedEvent) return;
    setEditError('');
    setEditSaving(true);
    try {
      const updated = await updateAdminEvent(
        session.idToken,
        selectedEvent.eventId,
        {
          name: editName,
          date: new Date(editDate).toISOString(),
          retentionDays: editRetentionDays,
        },
      );
      setEvents((current) =>
        current.map((candidate) =>
          candidate.eventId === updated.eventId ? updated : candidate,
        ),
      );
    } catch {
      setEditError(
        'No se pudo actualizar el evento. Revisa los datos e inténtalo de nuevo.',
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function onDeleteEvent() {
    if (!session || !selectedEvent) return;
    setDeleteError('');
    setDeletingEvent(true);
    try {
      await deleteAdminEvent(session.idToken, selectedEvent.eventId);
      const remaining = events.filter(
        (event) => event.eventId !== selectedEvent.eventId,
      );
      setEvents(remaining);
      setSelectedEventId(remaining[0]?.eventId ?? '');
      setConfirmingDelete(false);
    } catch {
      setDeleteError('No se pudo eliminar el evento. Inténtalo de nuevo.');
    } finally {
      setDeletingEvent(false);
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
        {selectedEvent ? (
          <section aria-labelledby="edit-event-title">
            <h3 id="edit-event-title">Editar evento</h3>
            <form
              onSubmit={(event) => void onSaveEdit(event)}
              className="admin-event-form"
            >
              <label className="field">
                <span>Nuevo nombre</span>
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Día y hora</span>
                <input
                  type="datetime-local"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Días de conservación</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={editRetentionDays}
                  onChange={(event) =>
                    setEditRetentionDays(Number(event.target.value))
                  }
                  required
                />
              </label>
              {editError ? (
                <p className="field-error" role="alert">
                  {editError}
                </p>
              ) : null}
              <button
                className="button button-primary"
                type="submit"
                disabled={editSaving}
              >
                {editSaving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </form>
          </section>
        ) : null}
        {selectedEventId ? (
          <>
            <GalleryEmailSender
              key={selectedEventId}
              eventId={selectedEventId}
              token={session?.idToken ?? ''}
            />
            <BulkPhotoUploader
              eventId={selectedEventId}
              token={session?.idToken ?? ''}
            />
            <EventPhotoManager
              key={`photos-${selectedEventId}`}
              eventId={selectedEventId}
              token={session?.idToken ?? ''}
            />
            <section aria-labelledby="delete-event-title">
              <h3 id="delete-event-title">Eliminar evento</h3>
              <p>
                Esta acción es <strong>irreversible</strong>: elimina fotos,
                inscripciones, coincidencias, enlaces de galería y la colección
                facial de este evento.
              </p>
              {deleteError ? (
                <p className="field-error" role="alert">
                  {deleteError}
                </p>
              ) : null}
              {confirmingDelete ? (
                <div>
                  <p>¿Confirmas que quieres eliminar este evento?</p>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={deletingEvent}
                    onClick={() => void onDeleteEvent()}
                  >
                    {deletingEvent ? 'Eliminando…' : 'Confirmar eliminación'}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={deletingEvent}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Eliminar evento
                </button>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
