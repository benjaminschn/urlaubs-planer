import { describe, expect, it, vi } from "vitest";
import { createSupabaseAuthGateway } from "./supabase-gateway";

describe("Supabase-Auth-Adapter", () => {
  it("nutzt Passwort-Login, geprüften TOTP-Faktor und lokale Abmeldung", async () => {
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "member-a", email: "member@example.test" } } },
          error: null
        }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "member-a", email: "member@example.test" } } },
          error: null
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: vi
            .fn()
            .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null }),
          listFactors: vi.fn().mockResolvedValue({
            data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
            error: null
          }),
          challenge: vi.fn().mockResolvedValue({ data: { id: "challenge-1" }, error: null }),
          verify: vi.fn().mockResolvedValue({ error: null })
        },
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe } } })
      }
    };
    const gateway = createSupabaseAuthGateway(client as never);

    await gateway.signInWithPassword("member@example.test", "password");
    const assurance = await gateway.getMfaAssurance();
    const factors = await gateway.listFactors();
    await gateway.challengeFactor("factor-1");
    await gateway.verifyFactor("factor-1", "challenge-1", "123456");
    await gateway.signOut();

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.test",
      password: "password"
    });
    expect(assurance).toMatchObject({ currentLevel: "aal1", nextLevel: "aal2" });
    expect(factors.factors).toEqual([{ id: "factor-1", type: "totp", status: "verified" }]);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("bereinigt den Auth-State-Listener", () => {
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe } } })
      }
    };
    const gateway = createSupabaseAuthGateway(client as never);
    const remove = gateway.onAuthStateChange(() => undefined);

    remove();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
