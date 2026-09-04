import React from 'react';
import { useAuth } from '../../context/auth';
import { DEMO_EVENT } from '../../fixtures';
import { BulkPhotoUploader } from './BulkPhotoUploader';

export function AdminEvents({ onLogout }: { onLogout: () => void }) {
  const { logout } = useAuth();
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
        <p>
          <strong>{DEMO_EVENT.name}</strong>
          <br />
          {DEMO_EVENT.location}
        </p>
        <BulkPhotoUploader eventId={DEMO_EVENT.id} />
      </section>
    </main>
  );
}
