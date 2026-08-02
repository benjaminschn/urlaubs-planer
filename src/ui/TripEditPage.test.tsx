import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../app/App";
import { createFakeGateway } from "../test/fake-gateway";
import { createFakeTripGateway } from "../test/fake-trip-gateway";

async function signInAndOpenEditor() {
  const auth = createFakeGateway();
  const trip = createFakeTripGateway();
  const user = userEvent.setup();
  render(<App gateway={auth.gateway} tripGateway={trip.gateway} />);
  await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
  await user.type(screen.getByLabelText("Passwort"), "password");
  await user.click(screen.getByRole("button", { name: "Anmelden" }));
  await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
  await user.click(screen.getByRole("button", { name: "Bestätigen" }));
  await screen.findByRole("heading", { name: "Testreise" });
  await user.click(screen.getByRole("button", { name: "Reise bearbeiten" }));
  await screen.findByRole("heading", { name: "Reise bearbeiten" });
  return { user, auth, trip };
}

describe("Reisekopf", () => {
  it("weist fehlende Pflichtwerte feldnah und in der Zusammenfassung zurück", async () => {
    const { user, trip } = await signInAndOpenEditor();
    await user.clear(screen.getByLabelText("Reisetitel"));
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Bitte prüfen Sie folgende Angaben:");
    expect(screen.getByRole("alert")).toHaveTextContent("Geben Sie einen Reisetitel ein.");
    expect(trip.calls.update).toBe(0);
  });

  it("weist ein Enddatum vor dem Startdatum zurück", async () => {
    const { user, trip } = await signInAndOpenEditor();
    fireEvent.change(screen.getByLabelText("Enddatum"), { target: { value: "2026-08-01" } });
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Das Enddatum darf nicht vor dem Startdatum liegen.");
    expect(trip.calls.update).toBe(0);
  });

  it("speichert nach Serverbestätigung genau eine Version und bietet keine zweite Reise an", async () => {
    const { user, trip } = await signInAndOpenEditor();
    await user.clear(screen.getByLabelText("Reisetitel"));
    await user.type(screen.getByLabelText("Reisetitel"), "Neue Testreise");
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    expect(await screen.findByRole("heading", { name: "Neue Testreise" })).toBeInTheDocument();
    expect(trip.calls.update).toBe(1);
    expect(trip.getTrip().version).toBe(2);
    expect(screen.queryByRole("button", { name: /neue reise/i })).not.toBeInTheDocument();
  });

  it("lädt bei einem Versionskonflikt den kanonischen Stand und verwirft den lokalen Schreibversuch", async () => {
    const { user, trip } = await signInAndOpenEditor();
    await user.clear(screen.getByLabelText("Reisetitel"));
    await user.type(screen.getByLabelText("Reisetitel"), "Lokaler Entwurf");
    trip.mutateExternally("Stand der anderen Person");
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    await waitFor(() => expect(screen.getByDisplayValue("Stand der anderen Person")).toBeInTheDocument());
    expect(screen.getByText("Die Reise wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.")).toBeInTheDocument();
    expect(trip.calls.update).toBe(1);
    expect(trip.getTrip().title).toBe("Stand der anderen Person");
  });
});

describe("Reisekonfiguration und Realtime-Fallback", () => {
  it("zeigt bei fehlender Reise einen neutralen Konfigurationsfehler ohne Reiseeinstieg", async () => {
    const auth = createFakeGateway();
    const trip = createFakeTripGateway({ loadResult: "missing" });
    const user = userEvent.setup();
    render(<App gateway={auth.gateway} tripGateway={trip.gateway} />);
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));

    expect(await screen.findByRole("heading", { name: "Reisekonfiguration nicht verfügbar" })).toBeInTheDocument();
    expect(screen.queryByText("Testreise")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reise bearbeiten/i })).not.toBeInTheDocument();
    expect(trip.calls.update).toBe(0);
  });

  it("verwendet ein Realtime-Signal nur zur vollständigen Invalidierung", async () => {
    const auth = createFakeGateway();
    const trip = createFakeTripGateway();
    const user = userEvent.setup();
    render(<App gateway={auth.gateway} tripGateway={trip.gateway} />);
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    await screen.findByRole("heading", { name: "Testreise" });
    const loadCount = trip.calls.load;

    trip.emitSignal({ title: "Nicht kanonischer Payload" });

    await waitFor(() => expect(trip.calls.load).toBeGreaterThan(loadCount));
    expect(screen.getByRole("heading", { name: "Testreise" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nicht kanonischer Payload" })).not.toBeInTheDocument();
  });

  it("lädt den Serverstand nach einem Realtime-Ausfall bei Fokus-Rückkehr erneut", async () => {
    const auth = createFakeGateway();
    const trip = createFakeTripGateway();
    const user = userEvent.setup();
    render(<App gateway={auth.gateway} tripGateway={trip.gateway} />);
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    await screen.findByRole("heading", { name: "Testreise" });
    trip.setRealtimeStatus("disconnected");
    const loadCount = trip.calls.load;

    fireEvent(window, new Event("focus"));

    await waitFor(() => expect(trip.calls.load).toBeGreaterThan(loadCount));
    await waitFor(() => expect(screen.getByText("Synchronisierung aktiv")).toBeInTheDocument());
  });
});
