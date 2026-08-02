import { describe, expect, it } from "vitest";
import { createAuthController } from "./controller";
import { createFakeGateway } from "../test/fake-gateway";

describe("Auth-Controller", () => {
  it("startet bei doppeltem Tippen höchstens einen laufenden Login", async () => {
    const fake = createFakeGateway({ signInDelay: 20 });
    const controller = createAuthController(fake.gateway);

    const first = controller.signIn("person@example.test", "password");
    const second = controller.signIn("person@example.test", "password");
    fake.releaseSignIn();
    await Promise.all([first, second]);

    expect(fake.calls.signIn).toBe(1);
    expect(controller.getState().status).toBe("mfa_required");
  });

  it("zeigt für falsche Zugangsdaten eine neutrale Fehlermeldung", async () => {
    const fake = createFakeGateway({ signInError: new Error("account person@example.test not found") });
    const controller = createAuthController(fake.gateway);

    await controller.signIn("person@example.test", "password");

    expect(controller.getState()).toMatchObject({ status: "signed_out" });
    expect(JSON.stringify(controller.getState())).not.toContain("person@example.test");
    expect(JSON.stringify(controller.getState())).not.toContain("not found");
  });

  it("verlangt einen TOTP-Code und bereinigt den Zustand beim Logout", async () => {
    const fake = createFakeGateway();
    const controller = createAuthController(fake.gateway);

    await controller.signIn("person@example.test", "password");
    expect(controller.getState().status).toBe("mfa_required");
    await controller.verifyMfa("000000");
    expect(controller.getState().status).toBe("mfa_required");
    await controller.verifyMfa("123456");
    expect(controller.getState().status).toBe("authenticated");

    await controller.signOut();
    expect(fake.calls.signOut).toBe(1);
    expect(controller.getState()).toEqual({ status: "signed_out" });
  });

  it("gibt eine AAL1-Sitzung ohne eingerichteten zweiten Faktor nicht frei", async () => {
    const fake = createFakeGateway({ mfaConfigured: false });
    const controller = createAuthController(fake.gateway);

    await controller.signIn("person@example.test", "password");

    expect(controller.getState()).toMatchObject({ status: "signed_out" });
    expect(fake.calls.challenge).toBe(0);
  });

  it("sperrt die geschützte Sitzung bei Ablauf sofort", async () => {
    const fake = createFakeGateway();
    const controller = createAuthController(fake.gateway);
    await controller.signIn("person@example.test", "password");
    await controller.verifyMfa("123456");

    controller.expireSession();

    expect(controller.getState()).toEqual({ status: "signed_out" });
  });
});
