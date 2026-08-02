import { useTrip } from "../trip/context";

export function TripUnavailablePage() {
  const { state, reload } = useTrip();
  const isLoading = state.status === "loading";
  const message =
    state.status === "configuration_error" || state.status === "error"
      ? state.message
      : "Die gemeinsame Reise ist derzeit nicht verfügbar.";

  return (
    <main className="centered-state">
      <section className="state-card" role="alert" aria-labelledby="trip-unavailable-title">
        <p className="eyebrow">Gemeinsamer Reiseplaner</p>
        <h1 id="trip-unavailable-title">Reisekonfiguration nicht verfügbar</h1>
        <p>{message}</p>
        <button className="primary-button state-action" type="button" onClick={() => void reload()} disabled={isLoading}>
          {isLoading ? "Reise wird geladen …" : "Erneut laden"}
        </button>
      </section>
    </main>
  );
}
