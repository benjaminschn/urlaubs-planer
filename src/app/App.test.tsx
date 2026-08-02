import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeGateway } from "../test/fake-gateway";
import { createFakeTripGateway } from "../test/fake-trip-gateway";
import { createFakeDocumentGateway } from "../test/fake-document-gateway";

describe("geschützter Einstieg", () => {
  it("zeigt bei einem direkten Deep Link zuerst keine privaten Inhalte und behält das Ziel nach MFA", async () => {
    window.location.hash = "#/documents";
    const fake = createFakeGateway();
    const trip = createFakeTripGateway();
    const documents = createFakeDocumentGateway();
    render(<App gateway={fake.gateway} tripGateway={trip.gateway} documentGateway={documents.gateway} />);

    expect(screen.queryByRole("heading", { name: "Testreise" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));

    expect(await screen.findByRole("heading", { name: "Dokumente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dokumente" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#/documents");
  });

  it("sperrt nach Abmeldung auch über den Zurück-Weg wieder den geschützten Inhalt", async () => {
    window.location.hash = "#/app";
    const fake = createFakeGateway();
    const trip = createFakeTripGateway();
    render(<App gateway={fake.gateway} tripGateway={trip.gateway} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await user.type(await screen.findByLabelText("Bestätigungscode"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    await screen.findByRole("heading", { name: "Testreise" });

    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    await screen.findByLabelText("E-Mail-Adresse");
    expect(screen.queryByRole("heading", { name: "Testreise" })).not.toBeInTheDocument();

    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Testreise" })).not.toBeInTheDocument());
  });
});
