import { useState } from "react";
import { useAuth } from "../auth/context";
import { useRouter } from "../router/HashRouter";
import { useTrip } from "../trip/context";
import { formatTripDateRange } from "../trip/format";
import { TripEditPage } from "./TripEditPage";
import { TripOverviewPage } from "./TripOverviewPage";
import { TravelItemDetailPage } from "./TravelItemDetailPage";
import { TravelItemFormPage } from "./TravelItemFormPage";
import { travelItemRouteFromPath } from "../router/routes";
import { DocumentsPage } from "./DocumentsPage";
import { CandidateReviewPage } from "./CandidateReviewPage";
import { candidateRouteFromPath } from "../router/routes";

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
  const isDocuments = route.path === "/documents";
  const travelItemRoute = travelItemRouteFromPath(route.path);
  const candidateRoute = candidateRouteFromPath(route.path);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <div className="app-header-brand">
          <p className="eyebrow">Gemeinsamer Reiseplaner</p>
          <p className="app-title">{tripState.trip.title}</p>
          <p className="app-subtitle">{formatTripDateRange(tripState.trip.startDate, tripState.trip.endDate)}</p>
        </div>
        <button className="secondary-button" type="button" onClick={handleSignOut} disabled={isSigningOut}>
          {isSigningOut ? "Abmeldung …" : "Abmelden"}
        </button>
      </header>
      {realtimeStatus === "disconnected" ? (
        <p className="connection-banner" role="status" aria-live="polite">
          Verbindung wird wiederhergestellt. Änderungen werden nach Serverbestätigung angezeigt.
        </p>
      ) : null}
      <main id="main-content" className="protected-main" tabIndex={-1}>
        {route.path === "/trip" ? <TripEditPage /> : null}
        {route.path === "/app" || route.path === "/timeline" ? <TripOverviewPage /> : null}
        {travelItemRoute?.kind === "create" || travelItemRoute?.kind === "edit" ? <TravelItemFormPage /> : null}
        {travelItemRoute?.kind === "detail" ? <TravelItemDetailPage /> : null}
        {route.path === "/documents" ? <DocumentsPage /> : null}
        {candidateRoute ? <CandidateReviewPage /> : null}
      </main>
      <nav className="app-nav" aria-label="Bereichsnavigation">
        <button
          className={isHome ? "nav-link active" : "nav-link"}
          type="button"
          onClick={() => navigate("/app")}
          aria-current={isHome ? "page" : undefined}
        >
          <span className="nav-link-icon" aria-hidden="true">
            ▤
          </span>
          Timeline
        </button>
        <button
          className={isDocuments ? "nav-link active" : "nav-link"}
          type="button"
          onClick={() => navigate("/documents")}
          aria-current={isDocuments ? "page" : undefined}
        >
          <span className="nav-link-icon" aria-hidden="true">
            ☰
          </span>
          Dokumente
        </button>
      </nav>
    </div>
  );
}
