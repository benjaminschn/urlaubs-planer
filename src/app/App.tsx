import { useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "../auth/context";
import { HashRouter, useRouter } from "../router/HashRouter";
import { InviteDisabledPage } from "../ui/InviteDisabledPage";
import { LoadingScreen } from "../ui/LoadingScreen";
import { LoginPage } from "../ui/LoginPage";
import { NotFoundPage } from "../ui/NotFoundPage";
import { ProtectedShell } from "../ui/ProtectedShell";
import type { AuthGateway } from "../auth/types";
import { TripProvider, useTrip } from "../trip/context";
import type { TripGateway } from "../trip/types";
import { TripUnavailablePage } from "../ui/TripUnavailablePage";
import { createRuntimeServices } from "@runtime-services";
import { TravelItemProvider } from "../travel/context";
import type { TravelItemGateway } from "../travel/types";
import { DocumentProvider } from "../documents/context";
import type { DocumentGateway } from "../documents/types";

function RoutedApp() {
  const { state, signOut } = useAuth();
  const tripState = useTrip().state;
  const { route } = useRouter();

  if (state.status === "configuration_error") {
    return (
      <main className="centered-state">
        <section className="state-card" role="alert" aria-labelledby="config-error-title">
          <p className="eyebrow">Gemeinsamer Reiseplaner</p>
          <h1 id="config-error-title">Anwendung nicht verfügbar</h1>
          <p>{state.message}</p>
        </section>
      </main>
    );
  }

  if (state.status === "loading") {
    return <LoadingScreen />;
  }

  if (
    state.status === "signed_out" ||
    state.status === "signing_in" ||
    state.status === "mfa_required" ||
    state.status === "verifying_mfa"
  ) {
    return <LoginPage onCancelMfa={() => void signOut()} />;
  }

  if (route.kind === "login") {
    return <ProtectedRedirect />;
  }
  if (route.kind === "invite_disabled") {
    return <InviteDisabledPage />;
  }
  if (tripState.status === "idle" || tripState.status === "loading") {
    return <LoadingScreen />;
  }
  if (tripState.status === "configuration_error" || tripState.status === "error") {
    return <TripUnavailablePage />;
  }
  if (!route.known) {
    return <NotFoundPage />;
  }
  return <ProtectedShell />;
}

function ProtectedRedirect() {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate("/app", { replace: true });
  }, [navigate]);
  return <LoadingScreen />;
}

export function App({
  gateway,
  tripGateway,
  travelItemGateway,
  documentGateway
}: {
  gateway?: AuthGateway | null;
  tripGateway?: TripGateway | null;
  travelItemGateway?: TravelItemGateway | null;
  documentGateway?: DocumentGateway | null;
} = {}) {
  const runtimeServices = useMemo(
    () => (gateway === undefined && tripGateway === undefined && travelItemGateway === undefined && documentGateway === undefined ? createRuntimeServices() : null),
    [documentGateway, gateway, travelItemGateway, tripGateway]
  );
  const resolvedAuthGateway = gateway === undefined ? runtimeServices?.authGateway ?? null : gateway;
  const resolvedTripGateway = tripGateway === undefined ? runtimeServices?.tripGateway ?? null : tripGateway;
  const resolvedTravelItemGateway =
    travelItemGateway === undefined ? runtimeServices?.travelItemGateway ?? null : travelItemGateway;
  const resolvedDocumentGateway = documentGateway === undefined ? runtimeServices?.documentGateway ?? null : documentGateway;
  return (
    <AuthProvider gateway={resolvedAuthGateway}>
      <TripProvider gateway={resolvedTripGateway}>
        <TravelItemProvider gateway={resolvedTravelItemGateway}>
          <DocumentProvider gateway={resolvedDocumentGateway}>
            <HashRouter>
              <RoutedApp />
            </HashRouter>
          </DocumentProvider>
        </TravelItemProvider>
      </TripProvider>
    </AuthProvider>
  );
}
