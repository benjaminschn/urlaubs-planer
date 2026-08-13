import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../app/App";
import type { DocumentGateway } from "../documents/types";
import { createFakeGateway } from "../test/fake-gateway";
import { createFakeTripGateway } from "../test/fake-trip-gateway";
import { clearFakeDocumentStorage, createFakeDocumentGateway } from "../test/fake-document-gateway";

beforeEach(() => clearFakeDocumentStorage());

async function signInAndOpenDocuments(providedGateway?: DocumentGateway) {
  window.location.hash = "#/documents";
  const auth = createFakeGateway();
  const trip = createFakeTripGateway();
  const documents = createFakeDocumentGateway();
  const user = userEvent.setup();
  render(<App gateway={auth.gateway} tripGateway={trip.gateway} documentGateway={providedGateway ?? documents.gateway} />);
  await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
  await user.type(screen.getByLabelText("Passwort"), "password");
  await user.click(screen.getByRole("button", { name: "Anmelden" }));
  await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
  await user.click(screen.getByRole("button", { name: "Bestätigen" }));
  await screen.findByRole("heading", { name: "Dokumente" });
  return { user, documents };
}

describe("private Dokumente", () => {
  it("zeigt unabhängige Dateistatus und bietet nach Prüfung einen sicheren lokalen Download an", async () => {
    const { user } = await signInAndOpenDocuments();
    const input = screen.getByLabelText("Dateien auswählen");
    await user.upload(input, [
      new File(["%PDF-1.7\npassive\n%%EOF"], "reise.pdf", { type: "application/pdf" }),
      new File(["MZ executable"], "unsicher.pdf", { type: "application/pdf" })
    ]);

    expect((await screen.findAllByText("reise.pdf")).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText("unsicher.pdf")).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/Verfügbar/)).length).toBeGreaterThanOrEqual(1);
    expect(
      (await screen.findAllByText("Dateiendung oder Dateityp stimmen nicht mit dem Dateiinhalt überein.")).length
    ).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "Original öffnen" }));
    expect(await screen.findByRole("link", { name: "Original herunterladen" })).toHaveAttribute("download", "reise.pdf");
  });

  it("lehnt eine Auswahl mit mehr als fünf Dateien vor dem Upload verständlich ab", async () => {
    const { user } = await signInAndOpenDocuments();
    const input = screen.getByLabelText("Dateien auswählen");
    const files = Array.from({ length: 6 }, (_, index) => new File(["%PDF-1.7\n%%EOF"], `${index}.pdf`, { type: "application/pdf" }));
    await user.upload(input, files);
    expect(screen.getByRole("alert")).toHaveTextContent("höchstens fünf Dateien");
    expect(screen.queryByText("0.pdf")).not.toBeInTheDocument();
  });

  it("lässt einen verspäteten leeren Refresh den erfolgreichen Upload nicht überschreiben", async () => {
    const documents = createFakeDocumentGateway();
    let listCall = 0;
    let resolveStaleRefresh!: (result: Awaited<ReturnType<DocumentGateway["listDocuments"]>>) => void;
    const staleRefresh = new Promise<Awaited<ReturnType<DocumentGateway["listDocuments"]>>>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const gateway: DocumentGateway = {
      ...documents.gateway,
      listDocuments(tripId) {
        listCall += 1;
        return listCall === 2 ? staleRefresh : documents.gateway.listDocuments(tripId);
      },
      subscribeToDocuments({ onStatus }) {
        onStatus("connected");
        return () => undefined;
      }
    };
    const { user } = await signInAndOpenDocuments(gateway);

    await screen.findByRole("heading", { name: "Noch keine Dokumente" });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(listCall).toBe(2));
    await user.upload(
      screen.getByLabelText("Dateien auswählen"),
      new File(["%PDF-1.7\npassive\n%%EOF"], "reise.pdf", { type: "application/pdf" })
    );
    expect(await screen.findByRole("heading", { name: "Originaldokumente" })).toBeInTheDocument();

    resolveStaleRefresh({ kind: "ready", documents: [] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Originaldokumente" })).toBeInTheDocument());
  });

  it("startet die Verarbeitung ausdrücklich und zeigt nur unbestätigte Vorschläge", async () => {
    const { user } = await signInAndOpenDocuments();
    await user.upload(screen.getByLabelText("Dateien auswählen"), new File(["%PDF-1.7\npassive\n%%EOF"], "buchung.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Verarbeitung starten" }));

    expect(await screen.findByText("Unbestätigte Vorschläge")).toBeInTheDocument();
    expect(screen.getByText("Erkannte Unterkunft")).toBeInTheDocument();
    expect(screen.getByText("Die Vorschläge sind noch nicht bestätigt und erscheinen nicht in der Timeline.")).toBeInTheDocument();
  });

  it("bewahrt Korrekturen, zeigt Herkunft und bestätigt nur ausdrücklich", async () => {
    const { user } = await signInAndOpenDocuments();
    await user.upload(screen.getByLabelText("Dateien auswählen"), new File(["%PDF-1.7\npassive\n%%EOF"], "beleg.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Verarbeitung starten" }));
    await user.click(await screen.findByRole("button", { name: "Jetzt kontrollieren" }));

    expect(await screen.findByRole("heading", { name: "Ereignis kontrollieren" })).toBeInTheDocument();
    expect(screen.getAllByText("Im Original · 95 %")).toHaveLength(2);
    expect(screen.getByText(/Beispielbestätigung/)).toBeInTheDocument();
    const title = screen.getByLabelText("Titel *");
    await user.clear(title);
    await user.type(title, "Geprüfte Unterkunft");
    await user.click(screen.getByRole("button", { name: "Korrekturen speichern" }));
    expect(await screen.findByText(/Korrektur gespeichert/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ereignis bestätigen" }));
    expect(window.location.hash).toBe("#/events/77777777-7777-4777-8777-777777777777");
  });

  it("blockiert eine lokale Korrektur, wenn Realtime den Bearbeitungsstand geändert hat", async () => {
    const { user, documents } = await signInAndOpenDocuments();
    await user.upload(screen.getByLabelText("Dateien auswählen"), new File(["%PDF-1.7\npassive\n%%EOF"], "konflikt.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Verarbeitung starten" }));
    await user.click(await screen.findByRole("button", { name: "Jetzt kontrollieren" }));
    await user.clear(await screen.findByLabelText("Titel *"));
    await user.type(screen.getByLabelText("Titel *"), "Mein lokaler Titel");
    const candidate = documents.getExtractionRuns()[0].candidates[0];
    const remotePayload = {
      event_type_code: "accommodation", title: "Server-Titel", booking_status: "unknown",
      start_time: { local_date: "2026-09-01", local_time: null, precision: "date_only", iana_time_zone: null, utc_offset_minutes: null, instant_utc: null, resolution_status: "date_only" },
      end_time: null, locations: { main: null, start: null, end: null },
      common_details: { provider_name: "", booking_platform_name: "", management_url: "", booking_date: null, notes: "Andere Änderung", references: [], travelers: [], provider_contacts: [], price: {}, cancellation_deadline: null, cancellation_conditions: "", additional_attributes: [] },
      type_details: {}, segments: []
    };
    documents.mutateCandidateExternally(candidate.id, remotePayload);
    expect(await screen.findByText(/zwischenzeitlich geändert/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Korrekturen speichern" }));
    expect(await screen.findByText(/zum Schutz der anderen Änderung blockiert/)).toBeInTheDocument();
    expect(documents.getExtractionRuns()[0].candidates[0].canonicalPayload).toEqual(remotePayload);
  });

  it("verknüpft Validierungsfehler mit dem Feld und fokussiert es", async () => {
    const { user } = await signInAndOpenDocuments();
    await user.upload(screen.getByLabelText("Dateien auswählen"), new File(["%PDF-1.7\npassive\n%%EOF"], "fehler.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Verarbeitung starten" }));
    await user.click(await screen.findByRole("button", { name: "Jetzt kontrollieren" }));
    const title = await screen.findByLabelText("Titel *");
    await user.clear(title);
    await user.click(screen.getByRole("button", { name: "Korrekturen speichern" }));
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAttribute("aria-describedby", "candidate-validation-summary");
    expect(screen.getByRole("button", { name: "Geben Sie einen Ereignistitel ein." })).toBeInTheDocument();
  });
});
