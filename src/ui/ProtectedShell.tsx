import { useState } from "react";
import { useAuth } from "../auth/context";
import { useRouter } from "../router/HashRouter";
import { useTrip } from "../trip/context";
import { formatTripDateRange } from "../trip/format";
import { TripEditPage } from "./TripEditPage";
import { TripOverviewPage } from "./TripOverviewPage";

export function ProtectedShell() {
  const { signOut } = useAuth();
  const { route, navigate } = useRouter();
  const { state: tripState, realtimeStatus } = useTrip();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (tripState.status !== "ready") {
    return null;
  }

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }
    setIsSigningOut(true);
    await signOut();
    navigate("/login", { replace: true });
  }

  const isHome = route.path === "/app" || route.path === "/timeline";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <div>
          <p className="eyebrow">Gemeinsamer Reiseplaner</p>
          <p className="app-title">{tripState.trip.title}</p>
          <p className="app-subtitle">{formatTripDateRange(tripState.trip.startDate, tripState.trip.endDate)}</p>
        </div>
        <button className="secondary-button" type="button" onClick={handleSignOut} disabled={isSigningOut}>
          {isSigningOut ? "Abmeldung läuft …" : "Abmelden"}
        </button>
      </header>
      <nav className="app-nav" aria-label="Bereichsnavigation">
        <button
          className={isHome ? "nav-link active" : "nav-link"}
          type="button"
          onClick={() => navigate("/app")}
          aria-current={isHome ? "page" : undefined}
        >
          Übersicht
        </button>
        <button
          className={route.path === "/documents" ? "nav-link active" : "nav-link"}
          type="button"
          onClick={() => navigate("/documents")}
          aria-current={route.path === "/documents" ? "page" : undefined}
        >
          Dokumente
        </button>
      </nav>
      {realtimeStatus === "disconnected" ? (
        <p className="connection-banner" role="status" aria-live="polite">
          Verbindung wird wiederhergestellt. Änderungen werden nach Serverbestätigung angezeigt.
        </p>
      ) : null}
      <main id="main-content" className="protected-main" tabIndex={-1}>
        {route.path === "/trip" ? <TripEditPage /> : null}
        {route.path === "/app" || route.path === "/timeline" ? <TripOverviewPage /> : null}
        {route.path === "/documents" ? (
          <section className="state-card protected-card" aria-labelledby="documents-title">
            <p className="eyebrow">Dokumente</p>
            <h1 id="documents-title">Dokumente folgen in einer späteren Ausbaustufe.</h1>
            <p className="muted">Der gemeinsame Reisekopf ist bereits für beide Personen verfügbar.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
