import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../app/App";
import { createFakeGateway } from "../test/fake-gateway";
import { createFakeTripGateway } from "../test/fake-trip-gateway";
import { clearFakeDocumentStorage, createFakeDocumentGateway } from "../test/fake-document-gateway";

beforeEach(() => clearFakeDocumentStorage());

async function signInAndOpenDocuments() {
  window.location.hash = "#/documents";
  const auth = createFakeGateway();
  const trip = createFakeTripGateway();
  const documents = createFakeDocumentGateway();
  const user = userEvent.setup();
  render(<App gateway={auth.gateway} tripGateway={trip.gateway} documentGateway={documents.gateway} />);
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
    expect(await screen.findByText("unsicher.pdf")).toBeInTheDocument();
    expect((await screen.findAllByText(/Verfügbar/)).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("Dateiendung oder Dateityp stimmen nicht mit dem Dateiinhalt überein.")).toBeInTheDocument();

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
});
