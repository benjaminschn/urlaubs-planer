import { usePwa } from "./context";

export function PwaStatus() {
  const {
    connectionStatus,
    updateReady,
    registrationFailed,
    hasOpenForm,
    retryResync,
    activateUpdate,
    dismissUpdate
  } = usePwa();

  return (
    <div className="pwa-status-stack">
      {connectionStatus === "offline" ? (
        <section className="pwa-banner pwa-banner-warning" role="status" aria-live="polite">
          <strong>Offline</strong>
          <span>
            Angezeigte Daten können veraltet sein. Speichern, Hochladen und andere Serveraktionen sind
            blockiert; es wird nichts lokal als gespeichert vorgemerkt.
          </span>
        </section>
      ) : null}
      {connectionStatus === "reconnecting" ? (
        <section className="pwa-banner" role="status" aria-live="polite">
          <div><strong>Wieder online</strong><span>Serverstand wird neu geladen. Speichern bleibt bis zur erfolgreichen Synchronisierung blockiert.</span></div>
          <button className="secondary-button" type="button" onClick={() => void retryResync()}>Erneut synchronisieren</button>
        </section>
      ) : null}
      {registrationFailed ? (
        <section className="pwa-banner pwa-banner-warning" role="status">
          <span>Offline-Unterstützung konnte nicht aktiviert werden. Die App bleibt online nutzbar.</span>
        </section>
      ) : null}
      {updateReady ? (
        <section className="pwa-banner pwa-update-banner" role="status" aria-live="polite">
          <div>
            <strong>Neue Version verfügbar</strong>
            <span>
              {hasOpenForm
                ? "Schließen oder speichern Sie zuerst das geöffnete Formular. Die App wird nicht automatisch neu geladen."
                : "Aktualisieren Sie jetzt oder später. Die App wird nie automatisch neu geladen."}
            </span>
          </div>
          <div className="pwa-banner-actions">
            <button
              className="primary-button"
              type="button"
              disabled={hasOpenForm}
              onClick={() => void activateUpdate()}
            >
              Jetzt aktualisieren
            </button>
            <button className="secondary-button" type="button" onClick={dismissUpdate}>
              Später
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
