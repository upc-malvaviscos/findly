import React, { useEffect, useState } from 'react';
import { getEvent } from './api';
import { DEMO_EVENT } from './fixtures';
import { SelfieCaptureForm } from './components/SelfieCaptureForm';
import './styles.css';

export function App() {
  const [event, setEvent] = useState(DEMO_EVENT);
  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get('event');
    if (!eventId) return;
    void getEvent(eventId).then((foundEvent) => {
      if (foundEvent) setEvent(foundEvent);
    });
  }, []);
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
          <SelfieCaptureForm eventId={event.id} />
        </section>
      </div>
    </main>
  );
}
