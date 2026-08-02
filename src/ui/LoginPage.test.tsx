import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../auth/context";
import { LoginPage } from "./LoginPage";
import { createFakeGateway } from "../test/fake-gateway";

function renderLogin(gateway = createFakeGateway()) {
  return render(
    <AuthProvider gateway={gateway.gateway}>
      <LoginPage onCancelMfa={() => undefined} />
    </AuthProvider>
  );
}

describe("Anmeldeoberfläche", () => {
  it("hat beschriftete Felder, sichtbare Fehlerbereiche und bietet keine Registrierung an", async () => {
    const fake = createFakeGateway();
    const { container } = renderLogin(fake);
    const user = userEvent.setup();

    expect(await screen.findByLabelText("E-Mail-Adresse")).toBeInTheDocument();
    expect(screen.getByLabelText("Passwort")).toBeInTheDocument();
    expect(screen.queryByText(/registr|wiederherstell/i)).not.toBeInTheDocument();
    const accessibilityResults = await axe(container);
    expect(accessibilityResults.violations).toEqual([]);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("E-Mail-Adresse"));
  });

  it("ordnet Authentifizierungsfehler neutral und verständlich zu", async () => {
    const fake = createFakeGateway({ signInError: new Error("member@example.test does not exist") });
    renderLogin(fake);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "wrong");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/anmeldung/i);
    expect(alert).not.toHaveTextContent(/does not exist|member@example.test/i);
  });

  it("deaktiviert den laufenden Login und fordert danach den TOTP-Code an", async () => {
    const fake = createFakeGateway({ signInDelay: 50 });
    renderLogin(fake);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-Mail-Adresse"), "member@example.test");
    await user.type(screen.getByLabelText("Passwort"), "password");

    const button = screen.getByRole("button", { name: "Anmelden" });
    const firstClick = user.click(button);
    const secondClick = user.click(button);
    fake.releaseSignIn();
    await Promise.all([firstClick, secondClick]);

    await waitFor(() => expect(fake.calls.signIn).toBe(1));
    expect(await screen.findByRole("heading", { name: "Bestätigung erforderlich" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Bestätigungscode")).toHaveFocus());
  });
});
