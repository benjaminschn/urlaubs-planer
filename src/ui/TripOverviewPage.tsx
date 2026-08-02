import { useRouter } from "../router/HashRouter";
import { formatTripDateRange } from "../trip/format";
import { useTrip } from "../trip/context";
import { useTravelItems } from "../travel/context";
import { eventTypeLabels, formatLocalDate, formatLocalTime, sortTravelItems } from "../travel/format";
import type { TravelItem } from "../travel/types";

function itemLocationSummary(item: TravelItem): string | null {
  if (item.segments.length > 0) {
    const first = item.segments[0];
    const last = item.segments[item.segments.length - 1];
    return `${first.startLocation.name} → ${last.endLocation.name}`;
  }
  if (item.locations.start || item.locations.end) {
    return `${item.locations.start?.name ?? "Startort offen"} → ${item.locations.end?.name ?? "Zielort offen"}`;
  }
  return item.locations.main?.name ?? null;
}

function TravelItemCard({ item, onOpen }: { item: TravelItem; onOpen: () => void }) {
  const location = itemLocationSummary(item);
  return (
    <li>
      <article className="timeline-card">
        <div className="timeline-card-content">
          <p className="eyebrow">{eventTypeLabels[item.eventTypeCode]}</p>
          <h3>{item.title}</h3>
          <p className="timeline-time">{formatLocalTime(item.startTime)}</p>
          {location ? <p className="timeline-location">{location}</p> : null}
          {item.bookingStatus === "cancelled" ? <p className="status-text">Storniert</p> : null}
        </div>
        <button className="secondary-button" type="button" onClick={onOpen} aria-label={`${item.title} öffnen`}>
          Details
        </button>
      </article>
    </li>
  );
}

export function TripOverviewPage() {
  const { state: tripState, realtimeStatus: tripRealtimeStatus } = useTrip();
  const { state: itemState, isRefreshing } = useTravelItems();
  const { navigate } = useRouter();
  if (tripState.status !== "ready") return null;

  const groups = new Map<string, TravelItem[]>();
  for (const item of sortTravelItems(itemState.items)) {
    const current = groups.get(item.startTime.localDate) ?? [];
    current.push(item);
    groups.set(item.startTime.localDate, current);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const connectionMessage =
    tripRealtimeStatus === "connected"
      ? "Synchronisierung aktiv"
      : tripRealtimeStatus === "connecting"
        ? "Synchronisierung wird hergestellt …"
        : "Verbindung zur Synchronisierung wird wiederhergestellt …";

  return (
    <>
      <section className="trip-overview" aria-labelledby="trip-overview-title">
        <div>
          <p className="eyebrow">Gemeinsame Reise</p>
          <h1 id="trip-overview-title">{tripState.trip.title}</h1>
          <p className="trip-dates">{formatTripDateRange(tripState.trip.startDate, tripState.trip.endDate)}</p>
        </div>
        <div className="overview-actions">
          <button className="secondary-button" type="button" onClick={() => navigate("/events/new")}>
            Ereignis manuell anlegen
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate("/trip")}>
            Reise bearbeiten
          </button>
        </div>
      </section>
      <p className="sync-status" role="status" aria-live="polite">
        {isRefreshing ? "Timeline wird aktualisiert …" : connectionMessage}
      </p>
      {itemState.message ? <div className="error-summary" role="alert"><p>{itemState.message}</p></div> : null}
      {itemState.status === "loading" ? (
        <section className="state-card timeline-placeholder" aria-live="polite"><p>Timeline wird geladen …</p></section>
      ) : itemState.items.length === 0 ? (
        <section className="state-card timeline-placeholder" aria-labelledby="timeline-placeholder-title">
          <p className="eyebrow">Timeline</p>
          <h2 id="timeline-placeholder-title">Noch keine Ereignisse</h2>
          <p>Erfassen Sie fehlende Reisebestandteile manuell. Bestätigte Ereignisse erscheinen hier nach Serverbestätigung.</p>
          <button className="primary-button state-action" type="button" onClick={() => navigate("/events/new")}>
            Erstes Ereignis anlegen
          </button>
        </section>
      ) : (
        <section className="timeline" aria-labelledby="timeline-title">
          <div className="timeline-heading">
            <div>
              <p className="eyebrow">Timeline</p>
              <h2 id="timeline-title">Bestätigte Reiseereignisse</h2>
            </div>
            <p className="timeline-count">{itemState.items.length} von 30</p>
          </div>
          {sortedGroups.map(([localDate, items]) => (
            <section className="timeline-day" key={localDate} aria-labelledby={`timeline-day-${localDate}`}>
              <h3 id={`timeline-day-${localDate}`}>{formatLocalDate(localDate)}</h3>
              <ol>
                {items.map((item) => <TravelItemCard key={item.id} item={item} onOpen={() => navigate(`/events/${item.id}`)} />)}
              </ol>
            </section>
          ))}
        </section>
      )}
    </>
  );
}
