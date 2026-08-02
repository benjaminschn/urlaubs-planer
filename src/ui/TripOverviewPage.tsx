import { useRouter } from "../router/HashRouter";
import { formatTripDateRange } from "../trip/format";
import { useTrip } from "../trip/context";

export function TripOverviewPage() {
  const { state, realtimeStatus, isRefreshing } = useTrip();
  const { navigate } = useRouter();
  if (state.status !== "ready") {
    return null;
  }

  const connectionMessage =
    realtimeStatus === "connected"
      ? "Synchronisierung aktiv"
      : realtimeStatus === "connecting"
        ? "Synchronisierung wird hergestellt …"
        : "Verbindung zur Synchronisierung wird wiederhergestellt …";

  return (
    <>
      <section className="trip-overview" aria-labelledby="trip-overview-title">
        <div>
          <p className="eyebrow">Gemeinsame Reise</p>
          <h1 id="trip-overview-title">{state.trip.title}</h1>
          <p className="trip-dates">{formatTripDateRange(state.trip.startDate, state.trip.endDate)}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => navigate("/trip")}>
          Reise bearbeiten
        </button>
      </section>
      <p className="sync-status" role="status" aria-live="polite">
        {isRefreshing ? "Reise wird aktualisiert …" : connectionMessage}
      </p>
      {state.message ? (
        <div className="error-summary" role="alert">
          <p>{state.message}</p>
        </div>
      ) : null}
      <section className="state-card timeline-placeholder" aria-labelledby="timeline-placeholder-title">
        <p className="eyebrow">Timeline</p>
        <h2 id="timeline-placeholder-title">Noch keine Reiseereignisse</h2>
        <p>
          Reiseereignisse können in der nächsten Ausbaustufe ergänzt werden. Der gemeinsame Reisekopf ist bereits
          für beide Personen synchronisiert.
        </p>
      </section>
    </>
  );
}
