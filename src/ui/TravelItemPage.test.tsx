import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../app/App";
import { createFakeGateway } from "../test/fake-gateway";
import { createFakeTripGateway } from "../test/fake-trip-gateway";
import { createFakeTravelItemGateway } from "../test/fake-travel-item-gateway";

async function signInAndOpenTimeline() {
  window.location.hash = "#/app";
  const auth = createFakeGateway();
  const trip = createFakeTripGateway();
  const travelItems = createFakeTravelItemGateway();
  const user = userEvent.setup();
  render(<App gateway={auth.gateway} tripGateway={trip.gateway} travelItemGateway={travelItems.gateway} />);
  await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
  await user.type(screen.getByLabelText("Passwort"), "password");
  await user.click(screen.getByRole("button", { name: "Anmelden" }));
  await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
  await user.click(screen.getByRole("button", { name: "Bestätigen" }));
  await screen.findByRole("heading", { name: "Testreise" });
  return { user, travelItems };
}

async function createMinimalEvent(user: ReturnType<typeof userEvent.setup>, typeLabel: string, title: string) {
  await user.click(screen.getByRole("button", { name: "Ereignis manuell anlegen" }));
  await screen.findByRole("heading", { name: "Ereignis anlegen" });
  const typeValue = ({ Unterkunft: "accommodation", Flug: "flight", Bahn: "rail", Bus: "bus", Aktivität: "activity" } as Record<string, string>)[typeLabel];
  await user.selectOptions(screen.getByLabelText("Ereignisart"), typeValue);
  await user.type(screen.getByLabelText("Titel *"), title);
  await user.click(screen.getByRole("button", { name: "Ereignis speichern" }));
  await screen.findByRole("heading", { name: title });
}

describe("manuelle Reiseereignisse", () => {
  it("legt alle fünf Minimalereignisse an und zeigt sie als bestätigte Karten", async () => {
    const { user, travelItems } = await signInAndOpenTimeline();
    for (const [typeLabel, title] of [
      ["Unterkunft", "Hotel"],
      ["Flug", "Hinflug"],
      ["Bahn", "Zug"],
      ["Bus", "Busfahrt"],
      ["Aktivität", "Museum"]
    ] as const) {
      await createMinimalEvent(user, typeLabel, title);
      await user.click(screen.getByRole("button", { name: "Zurück zur Timeline" }));
      await screen.findByRole("heading", { name: "Bestätigte Reiseereignisse" });
    }
    expect((await travelItems.gateway.getTravelItems("22222222-2222-4222-8222-222222222222"))).toMatchObject({ kind: "ready" });
    expect(screen.getByText("Hotel")).toBeInTheDocument();
    expect(screen.getByText("Hinflug")).toBeInTheDocument();
    expect(screen.getByText("Zug")).toBeInTheDocument();
    expect(screen.getByText("Busfahrt")).toBeInTheDocument();
    expect(screen.getByText("Museum")).toBeInTheDocument();
  });

  it("blockiert ein Ende vor dem Beginn und hält die Eingaben sichtbar", async () => {
    const { user, travelItems } = await signInAndOpenTimeline();
    await user.click(screen.getByRole("button", { name: "Ereignis manuell anlegen" }));
    await user.type(await screen.findByLabelText("Titel *"), "Ungültig");
    const dates = screen.getAllByLabelText(/Lokales Datum/);
    await user.clear(dates[1]);
    await user.type(dates[1], "2026-08-31");
    await user.click(screen.getByRole("button", { name: "Ereignis speichern" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Ende darf nicht vor dem Beginn liegen");
    expect(screen.getByDisplayValue("Ungültig")).toBeInTheDocument();
    expect(travelItems.calls.create).toBe(0);
  });

  it("bewahrt eine zweistufige Verkehrsreise mit sichtbarer Reihenfolge", async () => {
    const { user, travelItems } = await signInAndOpenTimeline();
    await user.click(screen.getByRole("button", { name: "Ereignis manuell anlegen" }));
    await user.selectOptions(screen.getByLabelText("Ereignisart"), "rail");
    await user.type(screen.getByLabelText("Titel *"), "Zwei Züge");
    await user.click(screen.getByRole("button", { name: "Teilstrecken hinzufügen" }));
    expect(screen.getByText("Teilstrecke 1")).toBeInTheDocument();
    expect(screen.getByText("Teilstrecke 2")).toBeInTheDocument();
    expect(travelItems.calls.create).toBe(0);
  });

  it("entfernt ein Ereignis fachlich aus der Timeline und prüft die gelesene Version", async () => {
    const { user } = await signInAndOpenTimeline();
    await createMinimalEvent(user, "Aktivität", "Löschtest");
    await user.click(screen.getByRole("button", { name: "Ereignis löschen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("aus der normalen Timeline entfernt");
    await user.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(screen.queryByText("Löschtest")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Noch keine Ereignisse" })).toBeInTheDocument();
  });

  it("übernimmt nach einem Versionskonflikt die neue Version und kann erneut speichern", async () => {
    const { user, travelItems } = await signInAndOpenTimeline();
    await createMinimalEvent(user, "Aktivität", "Konflikttest");
    const item = travelItems.getItems()[0];
    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    travelItems.mutateExternally(item.id, "Änderung der anderen Person");
    await user.clear(screen.getByLabelText("Titel *"));
    await user.type(screen.getByLabelText("Titel *"), "Mein veralteter Entwurf");

    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("zwischenzeitlich geändert");
    expect(screen.getByLabelText("Titel *")).toHaveValue("Änderung der anderen Person");

    await user.clear(screen.getByLabelText("Titel *"));
    await user.type(screen.getByLabelText("Titel *"), "Erneut gespeichert");
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(await screen.findByRole("heading", { name: "Erneut gespeichert" })).toBeInTheDocument();
  });

  it("erholt sich nach einem vorübergehenden Timeline-Ladefehler über Realtime", async () => {
    const { user, travelItems } = await signInAndOpenTimeline();
    await createMinimalEvent(user, "Aktivität", "Vor Netzfehler");
    await user.click(screen.getByRole("button", { name: "Zurück zur Timeline" }));
    const item = travelItems.getItems()[0];
    travelItems.failNextLoad();
    travelItems.emitSignal();
    expect(await screen.findByRole("alert")).toHaveTextContent("konnten nicht geladen werden");

    travelItems.mutateExternally(item.id, "Nach Wiederverbindung");
    travelItems.emitSignal();
    expect(await screen.findByText("Nach Wiederverbindung")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("konnten nicht geladen werden")).not.toBeInTheDocument());
  });
});
